// scripts/backup.js: consistent snapshots of a live database, rotation that
// never touches migration backups.

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const Database = require("better-sqlite3");
const { loadApp, register } = require("./helpers");
const { backup, SNAPSHOT_PREFIX } = require("../scripts/backup");

const { app, dataDir } = loadApp();

test("snapshot of the running database, with its data", async () => {
  const agent = await register(app, "frank");
  await agent
    .post("/api/transactions")
    .send({ date: "2026-05-01", amountCents: 1234, categoryName: "Shopping" })
    .expect(201);

  const { file, removed } = backup({ dataDir, now: new Date("2026-05-02T10:20:30Z") });
  assert.equal(path.basename(file), `${SNAPSHOT_PREFIX}20260502-102030.db`);
  assert.deepEqual(removed, []);

  const snapshot = new Database(file, { readonly: true });
  assert.equal(snapshot.pragma("integrity_check", { simple: true }), "ok");
  assert.equal(snapshot.pragma("user_version", { simple: true }), 3);
  assert.equal(snapshot.prepare("SELECT amount_cents FROM transactions").get().amount_cents, 1234);
  snapshot.close();
});

test("rotation keeps the newest snapshots and never deletes migration backups", () => {
  const backupDir = path.join(dataDir, "backups");
  fs.writeFileSync(path.join(backupDir, "konto-v2-before-v3-20200101-000000.db"), "");

  for (let day = 10; day <= 14; day++) {
    backup({ dataDir, keep: 3, now: new Date(`2026-06-${day}T00:00:00Z`) });
  }
  const names = fs.readdirSync(backupDir).sort();
  assert.deepEqual(names, [
    "konto-backup-20260612-000000.db",
    "konto-backup-20260613-000000.db",
    "konto-backup-20260614-000000.db",
    "konto-v2-before-v3-20200101-000000.db",
  ]);

  backup({ dataDir, keep: 0, now: new Date("2026-06-15T00:00:00Z") });
  assert.equal(fs.readdirSync(backupDir).filter((n) => n.startsWith(SNAPSHOT_PREFIX)).length, 4);
});
