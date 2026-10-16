// Upgrade from schema v2 (as written by the v2 releases) to v3. Fixtures use
// fake data only.

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const Database = require("better-sqlite3");
const bcrypt = require("bcryptjs");
const { loadApp, login } = require("./helpers");

const FIXTURE_PASSWORD = "fixture-password";

// The v2 schema exactly as createSchemaV2 / migrateV1ToV2 wrote it.
function createV2Database(file) {
  const db = new Database(file);
  db.exec(`
    CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')),
      is_owner INTEGER NOT NULL DEFAULT 0, session_version INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE accounts (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL,
      name TEXT NOT NULL, color TEXT NOT NULL DEFAULT '#6B7280',
      opening_balance_cents INTEGER NOT NULL DEFAULT 0, is_default INTEGER NOT NULL DEFAULT 0,
      UNIQUE (user_id, name));
    CREATE TABLE categories (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL,
      name TEXT NOT NULL, color TEXT NOT NULL DEFAULT '#6B7280',
      type TEXT NOT NULL DEFAULT 'expense' CHECK (type IN ('income', 'expense')),
      UNIQUE (user_id, name));
    CREATE TABLE transactions (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL,
      account_id INTEGER NOT NULL,
      date TEXT NOT NULL CHECK (date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
      amount_cents INTEGER NOT NULL CHECK (amount_cents >= 0),
      type TEXT NOT NULL CHECK (type IN ('income', 'expense')),
      category_name TEXT NOT NULL, description TEXT);
    CREATE INDEX idx_transactions_user_date ON transactions (user_id, date);
    CREATE INDEX idx_transactions_account_date ON transactions (account_id, date);
    CREATE INDEX idx_categories_user ON categories (user_id);
    CREATE INDEX idx_accounts_user ON accounts (user_id);
  `);
  db.prepare("INSERT INTO users (id, username, password_hash, is_owner) VALUES (1, 'mario', ?, 1)").run(
    bcrypt.hashSync(FIXTURE_PASSWORD, 4),
  );
  db.exec(`
    INSERT INTO accounts VALUES (1, 1, 'Personale', '#112233', 10000, 1);
    INSERT INTO accounts VALUES (2, 1, 'Risparmi', '#445566', 0, 0);
    INSERT INTO categories VALUES (1, 1, 'Entrata', '#10B981', 'income');
    INSERT INTO categories VALUES (2, 1, 'Bar', '#F59E0B', 'expense');
    INSERT INTO categories VALUES (3, 1, 'Giroconto', '#64748B', 'expense');
    INSERT INTO transactions VALUES (5, 1, 1, '2026-03-05', 150000, 'income', 'Entrata', 'marzo');
    INSERT INTO transactions VALUES (6, 1, 1, '2026-03-06', 1230, 'expense', 'Bar', NULL);
    INSERT INTO transactions VALUES (7, 1, 1, '2026-03-07', 20000, 'expense', 'Giroconto', 'a risparmi');
    INSERT INTO transactions VALUES (8, 1, 2, '2026-03-07', 20000, 'income', 'Entrata', 'da personale');
    -- ids up to 30 were used and deleted
    UPDATE sqlite_sequence SET seq = 30 WHERE name = 'transactions';
  `);
  db.pragma("user_version = 2");
  db.close();
}

const { app, db, dataDir } = loadApp({
  prepareDataDir: (dir) => createV2Database(path.join(dir, "konto.db")),
});

test("schema v3 with a v2 backup", () => {
  assert.equal(db.pragma("user_version", { simple: true }), 3);
  const backups = fs.readdirSync(path.join(dataDir, "backups"));
  assert.equal(backups.length, 1);
  assert.match(backups[0], /^konto-v2-before-v3-.*\.db$/);
  const backup = new Database(path.join(dataDir, "backups", backups[0]), { readonly: true });
  assert.equal(backup.pragma("user_version", { simple: true }), 2);
  assert.equal(backup.prepare("SELECT COUNT(*) AS n FROM transactions").get().n, 4);
  backup.close();

  const indexes = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'transactions' ORDER BY name")
    .all()
    .map((row) => row.name);
  assert.deepEqual(indexes, [
    "idx_transactions_account_date",
    "idx_transactions_transfer",
    "idx_transactions_user_date",
  ]);
});

test("existing transactions and balances are unchanged, old transfers are not guessed", async () => {
  const mario = await login(app, "mario", FIXTURE_PASSWORD);
  const rows = (await mario.get("/api/transactions")).body;
  assert.deepEqual(
    rows.map((t) => [t.id, t.date, t.amountCents, t.type, t.categoryName, t.description, t.accountId, t.transferId]),
    [
      [8, "2026-03-07", 20000, "income", "Entrata", "da personale", 2, null],
      [7, "2026-03-07", 20000, "expense", "Giroconto", "a risparmi", 1, null],
      [6, "2026-03-06", 1230, "expense", "Bar", null, 1, null],
      [5, "2026-03-05", 150000, "income", "Entrata", "marzo", 1, null],
    ],
  );
  const accounts = (await mario.get("/api/accounts")).body;
  assert.deepEqual(
    accounts.map((a) => [a.name, a.balanceCents]),
    [
      ["Personale", 10000 + 150000 - 1230 - 20000],
      ["Risparmi", 20000],
    ],
  );
});

test("ids of deleted rows are not reused and transfers work on the migrated data", async () => {
  const mario = await login(app, "mario", FIXTURE_PASSWORD);
  const res = await mario
    .post("/api/transfers")
    .send({ date: "2026-03-20", amountCents: 5000, fromAccountId: 1, toAccountId: 2 });
  assert.equal(res.status, 201);
  assert.equal(res.body.transfer.id, 31);
  const accounts = (await mario.get("/api/accounts")).body;
  assert.deepEqual(accounts.map((a) => a.balanceCents), [138770 - 5000, 25000]);
});
