// Writes a consistent snapshot of the database to <data dir>/backups/, safe
// to run while the app is in use (a plain file copy taken during a write
// could be corrupt). Meant for cron, followed by an upload of the snapshot
// (rclone, a cloud drive...). Only its own snapshots are rotated: migration
// backups are never deleted.
//
// Usage:
//   node scripts/backup.js [--keep N]          (default: keep the last 30)
//   docker compose exec konto node backend/scripts/backup.js
//
// --keep 0 keeps every snapshot. The path of the new snapshot is printed on
// the last line, so a cron job can pick it up.

require("dotenv").config({ path: require("path").join(__dirname, "..", ".env"), quiet: true });

const fs = require("fs");
const path = require("path");
const { openExistingDatabase } = require("../db");

const SNAPSHOT_PREFIX = "konto-backup-";
const DEFAULT_KEEP = 30;

function snapshotName(date) {
  const stamp = date.toISOString().replace(/[-:]/g, "").replace(/\..+/, "").replace("T", "-");
  return `${SNAPSHOT_PREFIX}${stamp}.db`;
}

// Returns { file, removed }: the new snapshot and the old ones deleted.
function backup({ dataDir, keep = DEFAULT_KEEP, now = new Date() } = {}) {
  const backendDir = path.join(__dirname, "..");
  const dir = dataDir || path.join(backendDir, "data");
  const db = openExistingDatabase({ dataDir: dir, backendDir });
  const backupDir = path.join(dir, "backups");
  fs.mkdirSync(backupDir, { recursive: true });

  const file = path.join(backupDir, snapshotName(now));
  try {
    db.prepare("VACUUM INTO ?").run(file);
  } finally {
    db.close();
  }

  // Names sort chronologically: the oldest ones beyond `keep` go.
  const snapshots = fs
    .readdirSync(backupDir)
    .filter((name) => name.startsWith(SNAPSHOT_PREFIX) && name.endsWith(".db"))
    .sort();
  const removed = keep > 0 ? snapshots.slice(0, Math.max(0, snapshots.length - keep)) : [];
  for (const name of removed) fs.rmSync(path.join(backupDir, name));

  return { file, removed };
}

function parseKeep(args) {
  const index = args.indexOf("--keep");
  if (index === -1) return DEFAULT_KEEP;
  const keep = Number(args[index + 1]);
  if (!Number.isInteger(keep) || keep < 0) {
    console.error("Usage: node scripts/backup.js [--keep N]   (N ≥ 0, 0 = keep all)");
    process.exit(1);
  }
  return keep;
}

if (require.main === module) {
  const { file, removed } = backup({
    dataDir: process.env.KONTO_DATA_DIR,
    keep: parseKeep(process.argv.slice(2)),
  });
  if (removed.length) console.log(`Removed ${removed.length} old snapshot(s).`);
  console.log(file);
}

module.exports = { backup, SNAPSHOT_PREFIX };
