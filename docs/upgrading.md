# Upgrading

Database migrations run automatically at startup, after a backup. With Docker: `git pull && docker compose up -d --build`.

## From 1.x

Version 2 moves to an English database schema with ISO dates and amounts in integer cents. The upgrade is automatic on the first start:

- `backend/dati/spese.db` is moved to `backend/data/konto.db` (the whole `dati/` folder becomes `data/`);
- a snapshot of the old database is saved in `backend/data/backups/` before converting it;
- if some rows cannot be converted safely, the server stops without changing anything and tells you which ones.

To move a 1.x install to Docker at the same time, copy `backend/dati/spese.db` into `./data/` of the Docker install: the container renames it to `konto.db` and migrates it the same way, keeping the backup in `./data/backups/`.

Anything outside Konto that reads `backend/dati/spese.db` (e.g. a backup cron job) must be pointed to the new path. The API paths changed as well (everything is now under `/api`).
