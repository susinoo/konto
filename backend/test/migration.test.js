// Upgrade from the legacy Italian schema (v1, user_version 0, as found on
// existing installations) to the current schema (v1 → v2 → v3). Fixtures use fake data only.

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const Database = require("better-sqlite3");
const bcrypt = require("bcryptjs");
const { loadApp, login } = require("./helpers");
const { prepareDataDir, openDatabase } = require("../db");

const FIXTURE_PASSWORD = "fixture-password";

// Same tables and column order an up-to-date legacy installation has (the
// later columns were added with ALTER TABLE, hence at the end).
function createLegacyDatabase(file, { badDate = false } = {}) {
  const db = new Database(file);
  const hash = bcrypt.hashSync(FIXTURE_PASSWORD, 4);
  db.exec(`
    CREATE TABLE categorie (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL,
      nome TEXT NOT NULL, colore TEXT NOT NULL DEFAULT '#6B7280', tipo TEXT NOT NULL DEFAULT 'uscita',
      UNIQUE(user_id, nome));
    CREATE TABLE spese (id INTEGER PRIMARY KEY AUTOINCREMENT, date TEXT NOT NULL, amount REAL NOT NULL,
      category TEXT NOT NULL, activity TEXT, user_id INTEGER, conto_id INTEGER,
      tipo TEXT NOT NULL DEFAULT 'uscita');
    CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')),
      is_owner INTEGER NOT NULL DEFAULT 0, session_version INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE conti (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL,
      nome TEXT NOT NULL, colore TEXT NOT NULL DEFAULT '#6B7280', saldo_iniziale REAL NOT NULL DEFAULT 0,
      is_default INTEGER NOT NULL DEFAULT 0, UNIQUE(user_id, nome));
    CREATE INDEX idx_spese_user_date ON spese (user_id, date);
  `);
  const insertUser = db.prepare(
    "INSERT INTO users (id, username, password_hash, is_owner) VALUES (?, ?, ?, ?)",
  );
  insertUser.run(1, "mario", hash, 1);
  insertUser.run(2, "luigi", hash, 0);
  db.exec(`
    INSERT INTO conti VALUES (1, 1, 'Personale', '#112233', 123.45, 1);
    INSERT INTO conti VALUES (2, 1, 'Lavoro', '#445566', -10.1, 0);
    INSERT INTO conti VALUES (3, 2, 'Conto principale', '#6B7280', 0, 1);
    INSERT INTO categorie VALUES (1, 1, 'Entrata', '#10B981', 'entrata');
    INSERT INTO categorie VALUES (2, 1, 'Stipendio', '#10B981', 'entrata');
    INSERT INTO categorie VALUES (3, 1, 'Bar', '#F59E0B', 'uscita');
    INSERT INTO categorie VALUES (4, 2, 'Bar', '#F59E0B', 'uscita');
    INSERT INTO spese VALUES (10, '05/03/26', 1500, 'Stipendio', 'marzo', 1, 1, 'entrata');
    INSERT INTO spese VALUES (11, '31/12/25', 12.3, 'Bar', '', 1, 1, 'uscita');
    INSERT INTO spese VALUES (12, '01/01/26', 0.1, 'Bar', '   ', 1, 2, 'uscita');
    INSERT INTO spese VALUES (13, '15/06/24', 4.5, 'Vecchia categoria', NULL, 1, 1, 'uscita');
    INSERT INTO spese VALUES (14, '20/02/26', 7, 'Bar', 'caffè', 2, 3, 'uscita');
    -- ids up to 40 were used and deleted
    UPDATE sqlite_sequence SET seq = 40 WHERE name = 'spese';
  `);
  if (badDate) db.exec("INSERT INTO spese VALUES (15, '2026-01-01', 1, 'Bar', NULL, 1, 1, 'uscita')");
  db.close();
}

const { app, db, dataDir } = loadApp({
  prepareDataDir: (dir) => createLegacyDatabase(path.join(dir, "spese.db")),
});

test("legacy spese.db is renamed to konto.db and a v1 backup is kept", () => {
  assert.ok(fs.existsSync(path.join(dataDir, "konto.db")));
  assert.ok(!fs.existsSync(path.join(dataDir, "spese.db")));
  const backups = fs.readdirSync(path.join(dataDir, "backups"));
  assert.equal(backups.length, 1);
  assert.match(backups[0], /^konto-v1-before-v2-.*\.db$/);
  const backup = new Database(path.join(dataDir, "backups", backups[0]), { readonly: true });
  assert.equal(backup.prepare("SELECT COUNT(*) AS n FROM spese").get().n, 5);
  backup.close();
});

test("schema v3: English tables only, user_version 3", () => {
  assert.equal(db.pragma("user_version", { simple: true }), 3);
  const tables = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
    .all()
    .map((t) => t.name);
  assert.deepEqual(tables, ["accounts", "categories", "transactions", "users"]);
});

test("transactions converted: ISO dates, cents, types, descriptions, ids", async () => {
  const mario = await login(app, "mario", FIXTURE_PASSWORD);
  const rows = (await mario.get("/api/transactions")).body;
  assert.deepEqual(
    rows.map((t) => [t.id, t.date, t.amountCents, t.type, t.categoryName, t.description, t.accountId]),
    [
      [10, "2026-03-05", 150000, "income", "Stipendio", "marzo", 1],
      [12, "2026-01-01", 10, "expense", "Bar", null, 2],
      [11, "2025-12-31", 1230, "expense", "Bar", null, 1],
      [13, "2024-06-15", 450, "expense", "Vecchia categoria", null, 1],
    ],
  );
});

test("accounts and categories converted, balances unchanged", async () => {
  const mario = await login(app, "mario", FIXTURE_PASSWORD);
  const accounts = (await mario.get("/api/accounts")).body;
  assert.deepEqual(
    accounts.map((a) => [a.id, a.name, a.openingBalanceCents, a.balanceCents, a.isDefault]),
    [
      [2, "Lavoro", -1010, -1020, false],
      [1, "Personale", 12345, 12345 + 150000 - 1230 - 450, true],
    ],
  );
  const categories = (await mario.get("/api/categories")).body;
  assert.deepEqual(
    categories.map((c) => [c.name, c.type]),
    [["Bar", "expense"], ["Entrata", "income"], ["Stipendio", "income"]],
  );
  const me = await mario.get("/api/auth/me");
  assert.equal(me.body.user.isOwner, true);
});

test("users keep their own data and ids of deleted rows are not reused", async () => {
  const luigi = await login(app, "luigi", FIXTURE_PASSWORD);
  const rows = (await luigi.get("/api/transactions")).body;
  assert.deepEqual(rows.map((t) => [t.id, t.date, t.description]), [[14, "2026-02-20", "caffè"]]);
  const created = await luigi
    .post("/api/transactions")
    .send({ date: "2026-03-01", amountCents: 100, categoryName: "Bar" });
  assert.equal(created.body.transaction.id, 41);
});

test("unconvertible legacy data aborts the migration and leaves the database untouched", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "konto-test-bad-"));
  const file = path.join(dir, "konto.db");
  createLegacyDatabase(file, { badDate: true });
  assert.throws(
    () => openDatabase({ dbPath: file, dataDir: dir, seedUsername: "x", getSeedPasswordHash: () => "", log: () => {} }),
    /1 transactions with a date not in DD\/MM\/YY format/,
  );
  const check = new Database(file, { readonly: true });
  assert.equal(check.pragma("user_version", { simple: true }), 1);
  assert.equal(check.prepare("SELECT COUNT(*) AS n FROM spese").get().n, 6);
  check.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test("default data directory: legacy backend/dati is moved to backend/data", () => {
  const backendDir = fs.mkdtempSync(path.join(os.tmpdir(), "konto-test-dir-"));
  fs.mkdirSync(path.join(backendDir, "dati", "backups"), { recursive: true });
  fs.writeFileSync(path.join(backendDir, "dati", "spese.db"), "");
  fs.writeFileSync(path.join(backendDir, "dati", "backups", "old.db"), "");

  const paths = prepareDataDir({ backendDir, log: () => {} });
  assert.equal(paths.dataDir, path.join(backendDir, "data"));
  assert.ok(fs.existsSync(path.join(backendDir, "data", "konto.db")));
  assert.ok(fs.existsSync(path.join(backendDir, "data", "backups", "old.db")));
  assert.ok(!fs.existsSync(path.join(backendDir, "dati")));
  fs.rmSync(backendDir, { recursive: true, force: true });
});
