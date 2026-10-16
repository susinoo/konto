# AGENTS.md

Guidance for AI coding agents (Claude Code, Codex, Cursor...) and for humans working on Konto. Read [ARCHITECTURE.md](ARCHITECTURE.md) before touching the database, the API or authentication: it is the source of truth for how things work.

## What Konto is

A self-hosted expense tracker for a few trusted users on a private network. One Node.js process serves the API (`backend/`, Express 5 + SQLite via `better-sqlite3`) and the built React frontend (`frontend/`, Vite + Tailwind 4).

## Commands

| Where | Command | What it does |
| --- | --- | --- |
| `backend/` | `npm run dev` | API on http://localhost:3000, restarts on changes (needs `backend/.env`, see `.env.example`) |
| `backend/` | `npm test` | Integration tests (`node:test` + `supertest`), each file on a throwaway database |
| `backend/` | `npm run seed:demo` / `npm run dev:demo` | Build / serve the fictional demo database (`john.doe`, `jane.doe` / `demo-password`) |
| `frontend/` | `npm run dev` | Vite dev server, proxies `/api` to :3000 |
| `frontend/` | `npm run lint` · `npm run i18n:check` · `npm run build` | ESLint, translation-file check, production build |
| root | `docker compose up -d --build` | Production-like run in Docker (see `docker-compose.yml`) |

The frontend has no automated tests: `lint`, `i18n:check` and `build` must pass. CI runs all of the above on every push and pull request.

## Rules that are easy to break

- **Everything in English**: code, comments, database, API, documentation. The UI is translated (English and Italian today).
- **No hard-coded UI text.** Every string goes through `t("key")` with the key in **every** file in `frontend/src/locales/`; amounts, dates and month names only through `frontend/src/utils/format.js`. Store keys in state, never translated text. Run `npm run i18n:check`.
- **Dates are ISO `YYYY-MM-DD` strings and amounts are integer cents** in the database, the API and frontend state. Convert only at the UI edges (`frontend/src/utils/money.js`).
- **Multi-user isolation**: every query on user data is scoped by `user_id`, and every `accountId` from the client is checked with `accountBelongsToUser`. `backend/test/isolation.test.js` must keep passing.
- **401 vs 400**: authenticated routes answer 400 to in-session validation errors, because the frontend treats any 401 as a logout.
- **API shape**: everything under `/api`; errors are `{ ok: false, code, message }` (new codes go in `ERROR_MESSAGES` in `server.js` and as `errors.<CODE>` in the locale files); `201` on create, `204` on delete, `PATCH` for categories/accounts, `PUT` for transactions and transfers.
- **Schema changes** are a new versioned migration in `backend/db.js` (`migrateV3ToV4`, bump `SCHEMA_VERSION`) plus a test that upgrades a database from the previous version. Never edit a migration that has shipped.
- **Transfers** are two linked rows (`transfer_out` / `transfer_in`, same `transfer_id`): always write them through `insertTransfer` or `/api/transfers`, never one row at a time. They move balances but never count as income, expenses or categories.
- **Naming**: camelCase in JavaScript and JSON fields, PascalCase for components, UPPER_SNAKE_CASE for constants, snake_case in SQL.

## Data and secrets

- Never commit `.env` files, databases (`backend/data/`, `backend/demo-data/`, `data/`) or real financial data.
- Use the demo database for manual tests, browser checks and screenshots, never real data.
- `backend/.env` is the only source of secrets and is loaded from an explicit path. `ecosystem.config.js` and the Docker files must never contain credentials.

## Before you finish

1. `cd backend && npm test`
2. `cd frontend && npm run lint && npm run i18n:check && npm run build`
3. Update [ARCHITECTURE.md](ARCHITECTURE.md), the docs in [docs/](docs/) and [CHANGELOG.md](CHANGELOG.md) when behavior, configuration or conventions change.
