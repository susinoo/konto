# Changelog

All notable changes to this project are documented here. The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Changed

- **Faster startup and navigation**: the instance configuration and the session check are requested in parallel (one round trip less on every cold start), and after login the Transactions, Analytics and Settings pages are prefetched in the background, so the first tap on them (or on the "+" button) no longer waits for a download.

## [2.0.0] — 2026-10-16 — first public release

### Changed (breaking)

- **Database schema v2**, migrated automatically on first start with a backup of the old database: English tables and columns (`transactions`, `categories`, `accounts`), ISO `YYYY-MM-DD` dates, amounts as integer cents, `income`/`expense` types, `CHECK` constraints, schema version in `PRAGMA user_version`.
- Data directory moved from `backend/dati/spese.db` to `backend/data/konto.db`.
- **API v2**: everything under `/api` (`/api/auth/*`, `/api/account/*`, `/api/categories`, `/api/accounts`, `/api/transactions`, `/api/analytics`, `/api/export/*`), camelCase JSON fields, amounts in cents, `201`/`204` status codes, `PATCH` for partial updates, errors as `{ ok: false, code, message }`.
- CSV export now includes the transaction type and account, with ISO dates.
- All code and comments translated to English.

### Added

- **Documentation and community**: `docs/` (installation, HTTPS, configuration, backups, upgrading, maintenance, security model), README with screenshots and FAQ, public `AGENTS.md`, fork-first `CONTRIBUTING.md`, GitHub issue and pull request templates, `DISCLAIMER.md` and a generated `THIRD_PARTY_NOTICES.md`.
- **CI** with GitHub Actions (backend tests on Node 22 and 24, frontend lint, translations and build, Docker build) and weekly Dependabot updates.
- **Mobile-first layout** (reference: iPhone 15 Pro): iOS safe areas and home-screen app metadata, whole transaction rows tappable to edit, no list/new tabs on phones, compact summaries on Dashboard and Analytics, month picker in the Analytics breakdown, wrapping names instead of truncation, scrollable bottom sheets, today's date and a decimal keyboard in the transaction form, thousands separator always shown.
- **Docker**: multi-stage `Dockerfile` (non-root, health check), `docker-compose.yml` with the port bound to `127.0.0.1` for `tailscale serve` on the host, and `docker-compose.tailscale.yml` with a Tailscale sidecar container. The manual install with PM2 remains documented.
- `HOST` setting to choose the listening interface, and graceful shutdown on `SIGTERM`/`SIGINT` (the database is closed cleanly).
- `scripts/backup.js`: consistent database snapshots, safe while the app runs, with rotation; meant for cron.
- **Transfers between accounts**: a third kind of entry next to income and expenses, stored as two linked rows (schema v3, migrated automatically with a backup). Transfers move the account balances but are not counted as income, expenses or categories. New `/api/transfers` endpoints; the CSV export has an extra "Transfer account" column.
- Demo data: `npm run seed:demo` builds a deterministic database with two fictional users, `npm run dev:demo` runs the app on it.

- **English and Italian interface** (react-i18next): language from the browser or Settings, locale-aware dates and amounts, `KONTO_CURRENCY` for the instance currency, default categories in the user's language (`KONTO_LOCALE` for the seed user), CSV export formatted per language, `npm run i18n:check`.

- MIT license, English documentation (README, ARCHITECTURE, SECURITY, CONTRIBUTING).
- Backend integration tests (`npm test` in `backend/`). Node.js 22 or newer is required.
- `REGISTRATION_ENABLED` setting: self-service registration is now **disabled by default**.
- `TRUST_PROXY` setting for deployments behind a reverse proxy, and `KONTO_DATA_DIR` for a custom data directory.
- `npm start` / `npm run dev` / `npm test` scripts in the backend.

### Security

- The GPL-3.0 `better-sqlite3-session-store` dependency is replaced by a small built-in session store (same table, existing sessions stay valid), so every distributed component is under a permissive license.
- Sessions are invalidated on other devices after a password change or reset, and everywhere after account deletion. Sessions are regenerated at login.
- Rate limiting on login, registration and password confirmations; async bcrypt; constant-time response for unknown usernames.
- Security headers (`helmet`, including a Content Security Policy), same-origin check on requests that change data, removal of a permissive CORS setup.
- Stricter server-side input validation (usernames, password length, names, descriptions, colors, amounts, calendar dates).
- JSON error responses without stack traces.
- CSV export protected against formula injection; database backup sent as a consistent snapshot.
- `reset-password.js` generates a random temporary password instead of a fixed one.
- Dependencies updated: `npm audit` reports no known vulnerabilities.

### Fixed

- The server crashed on first start with an empty database (default categories were seeded before a schema migration).
- Transaction list and CSV export are now sorted by actual date instead of by `DD/MM/YY` string.

### Changed

- New passwords must be at least 8 characters (previously 6). Existing passwords keep working.

### Removed

- Unused endpoints `/api/summary`, `/api/recent-expenses`, `/api/category-breakdown` and unused dependencies.

## [1.0.0]

First version used in production (private).

- Multi-user expense tracking with session login and per-user categories.
- Multiple accounts per user with opening and running balances, default account, and a registration wizard.
- Multiple income categories (type frozen on each transaction).
- Dashboard, transaction archive, yearly analytics with account filter.
- Password change, admin-assisted password reset, account deletion.
- CSV export and owner-only database backup.
- Dark mode, PWA manifest and icons.
