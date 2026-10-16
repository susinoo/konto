# Architecture

How Konto works internally: data model, migrations, authentication and the conventions to follow when changing the code. For installation, commands and deployment, see the [README](README.md).

## Overview

```
Browser (React SPA)
   │  fetch, session cookie, same origin
   ▼
Express (backend/server.js)
   ├─ helmet · compression · JSON body · Origin check · session
   ├─ public:     /api/config, /api/auth/*
   ├─ protected:  requireAuth → every other /api/* route
   ├─ static:     frontend/dist (+ catch-all → index.html)
   └─ error handler (JSON, no stack traces)
   │
   ▼
SQLite (better-sqlite3, backend/db.js): data/konto.db · data/sessions.db
```

**Same origin in production, two processes in development.** In production Express serves both the API and the static React build (`express.static(frontendDistPath)` plus a catch-all that returns `index.html` for client-side routing). In development the Vite dev server ([frontend/vite.config.js](frontend/vite.config.js)) proxies `/api` to `http://localhost:3000`. The whole backend API lives under `/api`.

**Backend layout.**

- [backend/db.js](backend/db.js): data directory, schema creation, versioned migrations, seed data.
- [backend/server.js](backend/server.js): configuration, middleware, authentication and every API route. It exports `{ app, db }` and only opens a port when run directly (`require.main === module`), so tests can import it.

## Database

SQLite through `better-sqlite3`, in the data directory (`backend/data/` by default, or `KONTO_DATA_DIR`; never versioned):

- `konto.db`: tables `users`, `accounts`, `categories`, `transactions`
- `sessions.db`: sessions, through Konto's own `express-session` store ([backend/sessionStore.js](backend/sessionStore.js)): one row per session (`sid`, `sess` as JSON, `expire` as an ISO timestamp), expired rows deleted every 15 minutes
- `backups/`: snapshots taken before schema migrations

### Schema (v3)

| Table | Columns |
| --- | --- |
| `users` | `id`, `username` (UNIQUE), `password_hash`, `created_at`, `is_owner` (0/1), `session_version` |
| `accounts` | `id`, `user_id`, `name`, `color`, `opening_balance_cents`, `is_default` (0/1), UNIQUE(`user_id`, `name`) |
| `categories` | `id`, `user_id`, `name`, `color`, `type` (`income`/`expense`), UNIQUE(`user_id`, `name`) |
| `transactions` | `id`, `user_id`, `account_id`, `date` (`YYYY-MM-DD`), `amount_cents` (≥ 0), `type` (`income`/`expense`/`transfer_in`/`transfer_out`), `category_name` (`NULL` for transfers), `description`, `transfer_id` (transfers only) |

`CHECK` constraints enforce the allowed `type` values, the date format, non-negative amounts and the shape of transfer rows (a `transfer_id` and no category, and the opposite for income and expenses). No foreign keys are declared: integrity and cascade deletes are handled in code (see *Account deletion*). Indexes cover `(user_id, date)`, `(account_id, date)`, `transfer_id` and the `user_id` of categories and accounts.

### Migrations

The schema version is stored in `PRAGMA user_version` and checked at every start by `openDatabase` in `db.js`:

- **empty database** → the v2 schema is created, then `migrateV2ToV3` runs (without a backup) and the seed owner is created. New and existing databases thus always go through the same migration code;
- **version 0 or 1** (legacy Italian schema: `spese`, `categorie`, `conti`, `DD/MM/YY` dates, REAL amounts) → the historical idempotent checks bring it to the final legacy shape (v1), then `migrateV1ToV2` converts it, then `migrateV2ToV3`;
- **version 2** → `migrateV2ToV3`, after a backup;
- **version 3** → nothing to do;
- **a newer version** → the server refuses to start rather than run old code on a newer schema.

`migrateV1ToV2` first checks that every row can be converted (valid `DD/MM/YY` dates, non-negative amounts, an owner for every transaction) and aborts without touching anything if not. It then saves a snapshot with `VACUUM INTO backups/konto-v1-before-v2-<timestamp>.db` and, in one transaction, creates the v2 tables, copies the data (dates to ISO, amounts to cents, `entrata`/`uscita` to `income`/`expense`, empty descriptions to `NULL`), keeps the ids and the AUTOINCREMENT counters, drops the old tables and sets `user_version = 2`.

`migrateV2ToV3` adds transfers. SQLite cannot change a `CHECK` constraint in place, so it saves a snapshot to `backups/konto-v2-before-v3-<timestamp>.db` (only when the database was already v2 on disk) and, in one transaction, rebuilds `transactions` with the new `type` values, the nullable `category_name` and the `transfer_id` column, keeping ids and the AUTOINCREMENT counter. Existing rows stay income and expenses: old "transfer" categories recorded as two separate transactions are not guessed into pairs.

`prepareDataDir` also moves legacy installations to the current layout before the database is opened: `backend/dati/` becomes `backend/data/` and `spese.db` becomes `konto.db` (with its rollback journal, if any).

**Changing the schema:** add a `migrateV3ToV4` step, bump `SCHEMA_VERSION` and add a test that upgrades a v3 database. Never edit a migration that has already shipped. Seeding always runs after the migrations.

## Dates and money

- **Dates** are ISO `YYYY-MM-DD` strings everywhere: database, API and `<input type="date">`. They sort and compare as plain strings. Period filters use half-open ranges (`date >= '2026-03-01' AND date < '2026-04-01'`, built by `periodRange`), which can use the index. The UI formats them for display in the user's language (`formatDate` in [frontend/src/utils/format.js](frontend/src/utils/format.js)).
- **Amounts** are integer cents everywhere: database (`amount_cents`, `opening_balance_cents`), API (`amountCents`, `balanceCents`, `incomeCents`...) and frontend state. Totals are therefore exact. The frontend converts only at the edges: `parseAmountToCents` turns user input into cents with string arithmetic (no floating-point rounding), `formatCents` fills number inputs ([frontend/src/utils/money.js](frontend/src/utils/money.js)) and `formatMoney` displays amounts in the UI language and instance currency ([frontend/src/utils/format.js](frontend/src/utils/format.js)). Transaction amounts are never negative: the sign comes from `type`. Opening balances can be negative.

## Multi-user and owner

`accounts`, `categories` and `transactions` all carry `user_id`, and every query is scoped to the logged-in user, including updates and deletes (`WHERE id = ? AND user_id = ?`). An `accountId` coming from the client is always checked with `accountBelongsToUser` before use. Thanks to `UNIQUE(user_id, name)`, different users can have categories or accounts with the same name.

On first start (empty database) the seed user is created from `KONTO_USER` / `KONTO_PASS` as the instance owner, with default categories and one account in the `KONTO_LOCALE` language. In production the server refuses to start without `KONTO_PASS` and `SESSION_SECRET`.

**Registration** (`POST /api/auth/register`) only works when `REGISTRATION_ENABLED=true`, and is disabled by default. The frontend reads `GET /api/config` to show or hide "Sign up". There is no invite code: when enabled, anyone who can reach the URL can register, so the network perimeter is the real gate. The request carries the UI language (`locale`), which picks the names of the new user's default categories and account (English or Italian, see `DEFAULT_NAMES` in `db.js`); they are user data and are never translated again afterwards. After registration the user is logged in automatically.

**Owner.** `users.is_owner` is an explicit, persistent flag. Only owners can download the full database (`GET /api/export/database`), which contains every user's data and password hashes. The app never reassigns it automatically, not even when the owner deletes their account; it is managed with [backend/scripts/set-owner.js](backend/scripts/set-owner.js).

## Accounts

Each user can have several accounts. **Categories are per user, not per account**: a category like "Bar" is shared by all of a user's accounts.

**Running balance, not period balance.** An account's `balanceCents` is computed on the fly (`ACCOUNTS_WITH_BALANCE_SQL`), never stored: opening balance plus **all** the account's transactions to date, whatever period is selected, as in a home-banking app. The period selector only affects which transactions are listed or charted.

**Per-page behavior** (a deliberate choice):

- **Dashboard**: always one specific account, never an aggregate. Without `accountId` the backend uses the user's default account.
- **Analytics** and **Transactions**: aggregate over all accounts by default, with an optional `accountId` filter. In the aggregated view, Transactions shows the account name on each row.

**Default account.** `accounts.is_default` marks the account preselected in the new-transaction form and used as the server-side fallback. Every user always has exactly one: making another account the default (`PATCH` with `isDefault: true`) clears the old one, and deleting the default account moves the flag to the oldest remaining account.

**Deletion guardrails** on `DELETE /api/accounts/:id`: you can't delete your last account (the app always needs one), nor an account that still has transactions (with no foreign keys, they would be orphaned).

**Registration wizard.** Registration creates a bootstrap account (`seedDefaultAccount`). The wizard shown right after ([RegistrationWizard.jsx](frontend/src/pages/RegistrationWizard.jsx)) **renames** it rather than creating a new one, so a user who abandons the wizard halfway still has a working account. Further accounts are created with `POST /api/accounts`.

## Income and expense categories

Each category has a `type`, `income` or `expense`, chosen at creation and immutable afterwards (only `name` and `color` can be changed). A user can have any number of income categories.

**The type is frozen on each transaction.** When a transaction is created or replaced, its type is resolved from the chosen category (`getCategoryType`) and written on the row. Likewise, `category_name` is a snapshot of the name rather than a live reference. Renaming or deleting a category therefore never changes past transactions.

All aggregations compare `transactions.type`, never a category name. Breakdown rows include `type`, so the frontend can split income from expenses dynamically.

`DELETE /api/categories/:id` refuses to delete a user's **last** income category, since the app always needs one to record income.

## Transfers between accounts

A transfer moves money between two of the same user's accounts. It is stored as **two linked rows** in `transactions`: a `transfer_out` row on the source account and a `transfer_in` row on the target account, with the same date, amount and description, no category and the same `transfer_id` (the id of the `transfer_out` row). `insertTransfer` in `db.js` writes both rows in one database transaction; it is shared by the API and the demo seed.

- **Balances** include transfers: `transfer_in` adds, `transfer_out` subtracts, like income and expenses.
- **Totals and categories** exclude them: income, expenses and net (dashboard, analytics, the net of the transactions list) only count `income` and `expense` rows, and category breakdowns skip rows with a `transfer_id`. Moving money between your own accounts is neither earning nor spending, and in the all-accounts view it would otherwise be counted twice.
- **Lists** show each row on its own account. The API adds `transferId` and `counterpartAccountId` (the account of the other row) to every transaction, `null` for income and expenses.
- **Writes go through `/api/transfers`**, which always updates or deletes both rows together, so the two halves can never diverge. `PUT` and `DELETE /api/transactions/:id` on a transfer row answer `400 IS_TRANSFER`.
- An account with transfers has transactions, so it cannot be deleted (`ACCOUNT_HAS_TRANSACTIONS`).

## Authentication and sessions

- **Session cookie** `konto.sid` (`express-session`, SQLite store): `httpOnly`, `SameSite=Lax`, `secure: "auto"` (Secure whenever the request arrives over HTTPS, directly or through a proxy trusted via `TRUST_PROXY`), rolling expiry of `SESSION_MAX_AGE_DAYS`.
- **Login and registration** call `session.regenerate()` (no session fixation) and store `{ id, username, isOwner, sessionVersion }` in the session. Passwords are checked with async bcrypt. An unknown username is compared against a dummy hash, so its response time is the same as for a wrong password.
- **`requireAuth`** guards every `/api` route except `/api/config` and `/api/auth/*`. On every request it checks that the user **still exists** and that `users.session_version` equals the version stored in the session. If not, the session is destroyed and the response is 401.
- **Session invalidation**: changing the password increments `session_version` and updates the current session, which stays valid while sessions on other devices stop working. `reset-password.js` and `rename-admin-account.js` also increment it. Deleting the account removes the user row, which invalidates all of their sessions. Sessions created before `session_version` existed count as version 0.
- **Rate limits** (in memory, per IP, `express-rate-limit`): login 10 failed attempts / 15 min, registration 5 / hour, password confirmations (change password, delete account) 10 failed attempts / 15 min. They reset when the process restarts.
- **CSRF**: besides `SameSite=Lax` and the JSON-only body parser, every non-GET request with an `Origin` header must match the request host (`req.host`, which honors `TRUST_PROXY`), otherwise it gets a 403.
- **Headers**: `helmet` with its default CSP (`'self'` only, since the frontend loads no external resources), minus `upgrade-insecure-requests` so the app still works over plain HTTP inside an encrypted private network. `x-powered-by` is disabled.

### 401 vs 400 convention

`apiFetch` in the frontend treats **any** 401 as an expired session and forces a logout. Authenticated routes must therefore return **400, not 401**, for in-session validation errors, such as `WRONG_PASSWORD` on `/api/account/change-password` or `/api/account/delete`. Keep 401 for real authentication failures only.

### Password management

- Logged in: *Settings → Account → Change password* (`POST /api/account/change-password`, requires the current password).
- Locked out: there is no e-mail recovery. Someone with shell access runs [backend/scripts/reset-password.js](backend/scripts/reset-password.js). It generates a random temporary password, prints it, verifies the stored hash and invalidates the user's sessions. The user then changes it from the UI.
- New passwords must be 8 characters to 72 bytes long (bcrypt ignores anything past 72 bytes, so longer passwords are rejected rather than silently truncated).

### Account deletion

*Settings → Delete account and data* (`POST /api/account/delete`, requires the current password) deletes, in a single transaction, the user's transactions, categories, accounts and finally the `users` row, then destroys the session. There are no foreign keys, so the order (children before parent) is handled in code.

## API

JSON fields are camelCase; database columns are snake_case and are converted by small mappers (`toTransaction`, `toAccount`, `toCategory`, `toPublicUser`). Lists are returned as plain arrays, while creations and updates return `{ ok: true, <resource> }`. Creations answer `201` and deletions `204`.

**Errors** are always `{ ok: false, code, message }`. `code` is a stable identifier (`INVALID_DATE`, `WRONG_PASSWORD`, `ACCOUNT_HAS_TRANSACTIONS`...) listed in `ERROR_MESSAGES` in `server.js`, and `message` is an English fallback. The frontend shows the translated text `errors.<CODE>` from its locale files ([frontend/src/utils/errors.js](frontend/src/utils/errors.js)).

| Method & path | Purpose |
| --- | --- |
| `GET /api/config` | Public config: `registrationEnabled`, `currency` |
| `POST /api/auth/login` · `POST /api/auth/register` · `POST /api/auth/logout` · `GET /api/auth/me` | Authentication |
| `POST /api/account/change-password` · `POST /api/account/delete` | The logged-in user's own profile |
| `GET`, `POST /api/categories` · `PATCH`, `DELETE /api/categories/:id` | Categories |
| `GET`, `POST /api/accounts` · `PATCH`, `DELETE /api/accounts/:id` | Accounts (with computed `balanceCents`) |
| `GET`, `POST /api/transactions` · `PUT`, `DELETE /api/transactions/:id` | Transactions; `GET` accepts `year`, `month`, `accountId` |
| `GET /api/transactions/years` · `GET /api/transactions/months?year` | Years and months that have data (period selectors) |
| `POST /api/transfers` · `PUT`, `DELETE /api/transfers/:id` | Transfers between two of the user's accounts (`:id` is the transfer id), body `{ date, amountCents, fromAccountId, toAccountId, description }` |
| `GET /api/dashboard?year&month[&accountId]` | Dashboard data in one round trip |
| `GET /api/analytics?year[&accountId]` | Analytics data in one round trip |
| `GET /api/export/transactions.csv?locale` | CSV export of the user's transactions, formula-injection safe. `locale=it` uses `;` and decimal commas with Italian headers, `en` (default) uses `,` and dots. Transfer rows also fill the last column with the account on the other side |
| `GET /api/export/database` | Full SQLite snapshot (`db.serialize()`), owner only |

## Input validation

Validation happens on the server; the frontend mirrors the limits for a better UX (`maxLength`, `minLength`, `pattern`, `step`).

| Field | Rule |
| --- | --- |
| `username` (registration) | 3–32 characters, `[A-Za-z0-9._-]` |
| category / account `name` | non-empty, max 50 characters |
| `description` | max 200 characters (trimmed, empty → `null`) |
| `color` | `#RRGGBB` |
| `amountCents` | safe integer, 0 ≤ x ≤ 100,000,000,000 (transfers: greater than 0) |
| `fromAccountId`, `toAccountId` (transfers) | two different accounts of the user (`SAME_ACCOUNT`, `INVALID_ACCOUNT`) |
| `openingBalanceCents` | safe integer, \|x\| ≤ 100,000,000,000 |
| `date` | `YYYY-MM-DD`, a real calendar date |
| `type` (categories) | `income` or `expense` |
| `year`, `month` (query) | four-digit year, month 1–12 |

JSON bodies are capped at 100 kB. Malformed JSON returns `INVALID_JSON` (400), and unknown `/api` routes return a JSON 404 instead of the SPA's `index.html`.

## Frontend

A single-page app with `react-router`. The `Dashboard` route loads eagerly; `Transactions`, `Analytics` and `Settings` are lazy-loaded via `React.lazy` in [App.jsx](frontend/src/App.jsx), which keeps the initial bundle small (`Analytics` pulls in `recharts`). Every backend call goes through [frontend/src/services/api.js](frontend/src/services/api.js): `apiFetch` always sends `credentials: "include"`, throws `NOT_AUTHORIZED` on 401 and leaves the logout to the caller; `readJson` handles empty `204` bodies. Styling uses Tailwind 4; dark mode follows the system theme. The UI is designed **mobile first** (reference: iPhone 15 Pro, 393×852): `viewport-fit=cover` with the `pt-safe` / `pb-safe` / `sheet-panel` utilities in `index.css` keeps the header, the bottom bar and bottom sheets clear of the notch and the home indicator; long names wrap instead of being truncated; amounts are typed in text inputs with `inputMode="decimal"` so iOS shows the locale's decimal key. Text sizes come from a small set of **type roles** in `index.css` (`type-section`, `type-row-title`, `type-amount`, `type-secondary`, `type-label`, `type-caption`), the same on every page; on phones the underlying scale follows iOS (17/15/13 px).

Shared helpers live in `frontend/src/utils/`: `money.js` (cents ↔ input values), `format.js` (locale-aware amounts, dates and month names), `errors.js` (translated API errors).

The main container (navbar + `<main>` in `App.jsx`) uses `max-w-6xl`. Pages should not declare their own narrower `max-w` without a specific reason, such as a single-column form.

## Internationalization

- **Library**: `react-i18next`, configured in [frontend/src/i18n.js](frontend/src/i18n.js). Translations live in `frontend/src/locales/<lang>.json` (bundled, nested by page: `dashboard.*`, `settings.*`, `errors.*`...). Components use `const { t } = useTranslation()`; rich text uses `<Trans>`; plurals use i18next suffixes (`count_one` / `count_other`).
- **Language**: the user's choice from Settings, saved in `localStorage` (`konto.language`), otherwise the browser language, otherwise English. `<html lang>` follows it. No language is stored server-side.
- **Formatting** (`utils/format.js`): amounts with `Intl.NumberFormat` in the UI language and the instance currency (`KONTO_CURRENCY`, read from `/api/config` at startup); dates and month names with `Intl.DateTimeFormat`. Labels are computed at render time, so switching language updates everything without a reload. Avoid storing translated text in state: store the key and translate when rendering.
- **Server-side text** is limited to error `message` fallbacks (English), the CSV headers and type labels (per `locale`), and the default category/account names (per registration `locale`).
- **Check**: `npm run i18n:check` in `frontend/` verifies that every language has the same keys and `{{placeholders}}`, and that every key-like string in the source exists.

## Performance

- `/api/transactions` filters by `year` / `month` in SQL, so the client never downloads everything to filter it.
- Analytics and Dashboard each use **one aggregated endpoint** (`/api/analytics`, `/api/dashboard`). To show more data there, extend those endpoints instead of adding per-month calls.
- Responses are gzip-compressed. The hashed assets in `frontend/dist/assets` are served with a long, immutable cache; `index.html` is not cached aggressively, so a new deploy shows up immediately.

## Configuration and secrets

`backend/.env` (never committed) is the only source of secrets. It is loaded from an **explicit path** (`path.join(__dirname, ".env")`), not from the process working directory, because PM2 and other process managers may start the process from a different directory. [ecosystem.config.js](ecosystem.config.js) contains no credentials: it reads `backend/.env` with a small built-in parser (no root-level `dotenv` dependency) and refuses to start if `KONTO_USER`, `KONTO_PASS` or `SESSION_SECRET` are missing.

Maintenance scripts open the database with `openExistingDatabase` from `db.js`. It never moves or migrates anything, and asks you to start the server first if the database is missing or on an older schema.

`scripts/backup.js` takes snapshots with `VACUUM INTO`, which is consistent even while the server writes (a plain file copy is not). Its snapshots are named `konto-backup-*.db` and rotated (`--keep`), while migration backups (`konto-v*-before-*.db`) in the same folder are never touched.

## Deployment and process lifecycle

- **Listening**: `PORT` and `HOST` (unset = all interfaces). In production the server speaks HTTPS when `SSL_CERT_PATH` / `SSL_KEY_PATH` point to existing files, plain HTTP otherwise (behind a TLS proxy, with `TRUST_PROXY`).
- **Graceful shutdown**: on `SIGTERM` / `SIGINT` the server stops accepting connections, lets running requests finish, closes the database and exits (forced after 10 s). `docker stop` and `pm2 restart` therefore never cut a write in half.
- **Docker**: the multi-stage [Dockerfile](Dockerfile) builds the frontend, installs the backend's production dependencies and copies both into a `node:24-bookworm-slim` image (glibc, so `better-sqlite3` uses its prebuilt binary). The app runs as the `node` user (uid 1000) with fixed `NODE_ENV=production`, `PORT=3000`, `HOST=0.0.0.0` and `KONTO_DATA_DIR=/data`; secrets come from `backend/.env` through Compose's `env_file`, never from the image ([.dockerignore](.dockerignore) keeps `.env`, data, certificates and tests out of the build context). `scripts/healthcheck.js` backs the `HEALTHCHECK` and follows the server's HTTP/HTTPS choice.
- **Compose setups**: [docker-compose.yml](docker-compose.yml) publishes the port on `127.0.0.1` only, for `tailscale serve` (or another proxy) on the host; requests then come from the Docker bridge, hence `TRUST_PROXY=loopback,uniquelocal`. [docker-compose.tailscale.yml](docker-compose.tailscale.yml) adds a Tailscale container that serves the app over HTTPS ([docker/tailscale-serve.json](docker/tailscale-serve.json)), proxying to `http://konto:3000` on the private Compose network, with `TRUST_PROXY=uniquelocal`. The app deliberately does not share the sidecar's network namespace: in userspace mode Tailscale forwards tailnet connections on any port to that namespace's `127.0.0.1`, which would expose the plain HTTP port, and requests arriving from loopback could then spoof `X-Forwarded-For` to dodge the login rate limit. Both keep the data in `./data` on the host.

## Tests

Integration tests live in [backend/test/](backend/test/) (`node:test` + `supertest`; run them with `npm test` in `backend/`). [helpers.js](backend/test/helpers.js) sets every relevant environment variable explicitly and points `KONTO_DATA_DIR` to a temporary directory. `node --test` runs each file in its own process, so each file gets a fresh database and fresh rate-limit counters.

| File | Covers |
| --- | --- |
| `auth.test.js` | first start on an empty DB, registration and login rules, session fixation, session invalidation, origin check, security headers |
| `isolation.test.js` | one user can never read or modify another user's data; owner-only database download |
| `validation.test.js` | dates, cents, colors, lengths, types, malformed JSON, period filters, exact totals, CSV injection |
| `migration.test.js` | upgrade of a legacy (v1) database: file rename, backup, converted values, balances, ids; abort on unconvertible data; legacy data directory move |
| `backup.test.js` | `backup.js`: consistent snapshot of a live database, rotation that never deletes migration backups |
| `migration-v3.test.js` | upgrade of a v2 database: backup, rebuilt table and indexes, unchanged data and balances, AUTOINCREMENT counter |
| `transfers.test.js` | transfer pairs, balances, exclusion from totals and categories, update/delete of both rows, validation, isolation, CSV, `CHECK` constraints |
| `ratelimit.test.js` | login lockout after repeated failures |
| `registration-disabled.test.js` | default behavior with registration off |
