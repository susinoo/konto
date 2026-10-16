# Backups

How to take consistent backups of the database.

`backup.js` writes a consistent snapshot of the database to `backups/` in the data directory, even while the app is in use (copying `konto.db` during a write could produce a corrupt copy). It keeps the last 30 snapshots (`--keep N`, `0` keeps all) and never deletes migration backups. The last line it prints is the path of the new snapshot.

```bash
docker compose exec konto node backend/scripts/backup.js   # Docker
cd backend && node scripts/backup.js                        # manual install
```

Run it from cron and copy the snapshot elsewhere, e.g. to a cloud drive with [rclone](https://rclone.org/):

```cron
0 3 * * * cd /path/to/Konto && docker compose exec -T konto node backend/scripts/backup.js && rclone copy data/backups remote:konto-backups
```

The instance owner can also download a snapshot from Settings at any time.
