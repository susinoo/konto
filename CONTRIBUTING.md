# Contributing to Konto

Thanks for your interest! Konto is a small personal project, and its goal is to be a good starting point for **your own** money tracker. Contributions come in two shapes, and both are welcome.

## Fork first

1. **Fork** the repository and make it yours: change the features, the look, the language, the deployment.
2. **Show your fork**: open a [Show your fork](https://github.com/susinoo/Konto/issues/new?template=show-your-fork.yml) issue with a link and a few words on what you changed. Interesting forks are listed in the README under *Community forks*, so others can find them.
3. **Send back what fits everyone** (optional): if a change would be useful to every Konto user (a bug fix, a translation, an improvement that keeps Konto simple), open a pull request. For anything larger, please **open an issue first**, so we can agree on the approach before you spend time on it.

Not every change belongs upstream, and that is fine: a fork that goes its own way is a success, not a failure.

## Development setup

See [Development](README.md#development) in the README: the backend and the frontend run as two processes (`npm run dev` in each folder). Use the demo data (`npm run seed:demo`, `npm run dev:demo` in `backend/`) for manual tests and screenshots.

If you work with an AI coding agent, point it to [AGENTS.md](AGENTS.md): it lists the commands and the rules that are easy to break.

## Before opening a pull request

```bash
cd backend && npm test
cd frontend && npm run lint && npm run i18n:check && npm run build
```

CI runs the same checks, plus a Docker build, on every pull request.

- Add or update **backend tests** for any change to routes, auth or data handling. User isolation (`backend/test/isolation.test.js`) must keep passing.
- Check UI changes on a **phone-sized screen** (393×852, an iPhone 15 Pro) in **both languages**: Konto is mobile first, and Italian texts are often longer.
- Update [ARCHITECTURE.md](ARCHITECTURE.md), the [docs](docs/) and [CHANGELOG.md](CHANGELOG.md) when behavior, configuration or conventions change.
- Never commit `.env` files, databases (`data/`, `backend/data/`, `backend/demo-data/`), real financial data, or screenshots that contain them.

## Conventions

- **Database changes** are a new versioned migration in `backend/db.js` (add `migrateV3ToV4`, bump `SCHEMA_VERSION`, never edit a shipped one) with a test that upgrades a database from the previous version. See [Migrations](ARCHITECTURE.md#migrations).
- **Every query on user data is scoped by `user_id`**, and any `accountId` from the client is checked with `accountBelongsToUser`.
- Authenticated routes return **400, not 401**, for in-session validation errors ([why](ARCHITECTURE.md#401-vs-400-convention)).
- Dates are ISO `YYYY-MM-DD` strings and amounts are integer cents, end to end ([details](ARCHITECTURE.md#dates-and-money)). Convert only at the UI edges (`frontend/src/utils/`).
- **Transfers** are written through `insertTransfer` or `/api/transfers` only, never one row at a time ([details](ARCHITECTURE.md#transfers-between-accounts)).
- Code, comments and documentation are in English. JavaScript uses camelCase (PascalCase for components, UPPER_SNAKE_CASE for constants), SQL uses snake_case; API fields are camelCase.
- **No hard-coded UI text**: every string goes through `t("…")` with a key in **every** file in `frontend/src/locales/`, and amounts/dates through `utils/format.js`. Run `npm run i18n:check`.
- **Text sizes** use the type roles in `frontend/src/index.css` (`type-section`, `type-row-title`, `type-amount`, `type-secondary`, `type-label`, `type-caption`) rather than ad-hoc `text-*` sizes.
- API errors are `{ ok: false, code, message }`: add new codes to `ERROR_MESSAGES` in `server.js` and their UI text as `errors.<CODE>` in the locale files.
- Commit messages: short imperative summary, with details in the body when useful.

## Adding a language

1. Copy `frontend/src/locales/en.json` to `<code>.json` (e.g. `de.json`) and translate the values, keeping the keys and the `{{placeholders}}`.
2. Register it in `frontend/src/i18n.js` (`resources` and `SUPPORTED_LANGUAGES`).
3. Optionally add default category and account names for new users in `DEFAULT_NAMES` (`backend/db.js`), the CSV format in `CSV_FORMATS` (`backend/server.js`) and a date style in `DATE_STYLES` (`frontend/src/utils/format.js`), plus the code in `SUPPORTED_LOCALES` (`backend/db.js`).
4. Run `npm run i18n:check` and `npm test`.

## Branches

- `main`: released code.
- `develop`: integration branch. Open pull requests against `develop`.

## Reporting security issues

Please do not open public issues for vulnerabilities: follow [SECURITY.md](SECURITY.md).

## License

By contributing, you agree that your contributions are licensed under the [MIT License](LICENSE).
