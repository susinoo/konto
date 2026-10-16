# Maintenance scripts

Run on the server from `backend/`, or with Docker as `docker compose exec -it konto node backend/scripts/<script>`. They read the same database as the app (`KONTO_DATA_DIR` is honored).

| Script | Purpose |
| --- | --- |
| `node scripts/reset-password.js` | Interactive. Generates a random temporary password for a user who is locked out and invalidates their sessions. The user then changes it from *Account → Profile*. |
| `node scripts/set-owner.js <username> [on\|off]` | Grants or revokes the *owner* flag (full database download). Never reassigned automatically. |
| `node scripts/backup.js [--keep N]` | Consistent snapshot of the database in `backups/`, see [Backups](backups.md). |
| `node scripts/rename-admin-account.js` | Renames the oldest user and sets their password from `KONTO_USER` / `KONTO_PASS` in `.env`. |
