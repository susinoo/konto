// The demo database must be valid (it goes through the real schema and API)
// and must never be written over real data.

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const Database = require("better-sqlite3");
const bcrypt = require("bcryptjs");
const { seedDemo, DEMO_PASSWORD } = require("../scripts/seed-demo");
const { loadApp, login } = require("./helpers");

const END_DATE = "2026-10-15";

// The app under test runs on the demo database itself.
const { app, db } = loadApp({
  prepareDataDir: (dir) => seedDemo({ dataDir: dir, endDate: END_DATE, log: () => {} }),
});

test("two demo users with two accounts each, John is the owner", async () => {
  const john = await login(app, "john.doe", DEMO_PASSWORD);
  const jane = await login(app, "jane.doe", DEMO_PASSWORD);
  assert.equal((await john.get("/api/auth/me")).body.user.isOwner, true);
  assert.equal((await jane.get("/api/auth/me")).body.user.isOwner, false);

  const johnAccounts = (await john.get("/api/accounts")).body.map((a) => a.name).sort();
  const janeAccounts = (await jane.get("/api/accounts")).body.map((a) => a.name).sort();
  assert.deepEqual(johnAccounts, ["Everyday", "Savings"]);
  assert.deepEqual(janeAccounts, ["Freelance", "Personal"]);
});

test("transactions cover every month up to the end date, never after it", async () => {
  const john = await login(app, "john.doe", DEMO_PASSWORD);
  assert.deepEqual((await john.get("/api/transactions/years")).body, [2026, 2025]);
  assert.deepEqual(
    (await john.get("/api/transactions/months?year=2026")).body,
    [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
  );
  const { last } = db.prepare("SELECT MAX(date) AS last FROM transactions").get();
  assert.ok(last <= END_DATE);
  const { count } = db.prepare("SELECT COUNT(*) AS count FROM transactions").get();
  assert.ok(count > 800, `only ${count} transactions`);
});

test("balances stay positive and every transfer is a complete pair", async () => {
  for (const username of ["john.doe", "jane.doe"]) {
    const agent = await login(app, username, DEMO_PASSWORD);
    for (const account of (await agent.get("/api/accounts")).body) {
      assert.ok(account.balanceCents > 0, `${username} / ${account.name}: ${account.balanceCents}`);
    }
  }
  const transfers = db
    .prepare(
      `SELECT transfer_id, COUNT(*) AS rows, SUM(type = 'transfer_out') AS outs,
         COUNT(DISTINCT amount_cents) AS amounts, COUNT(DISTINCT account_id) AS accounts
       FROM transactions WHERE transfer_id IS NOT NULL GROUP BY transfer_id`,
    )
    .all();
  assert.ok(transfers.length > 0);
  assert.ok(transfers.every((t) => t.rows === 2 && t.outs === 1 && t.amounts === 1 && t.accounts === 2));
});

test("deterministic: the same end date produces the same data", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "konto-demo-"));
  seedDemo({ dataDir: dir, endDate: END_DATE, log: () => {} });
  const other = new Database(path.join(dir, "konto.db"), { readonly: true });
  const snapshot = (database) =>
    database
      .prepare("SELECT date, amount_cents, category_name, description FROM transactions ORDER BY id")
      .all();
  assert.deepEqual(snapshot(other), snapshot(db));
  other.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test("refuses to overwrite a database with non-demo users", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "konto-demo-guard-"));
  const real = new Database(path.join(dir, "konto.db"));
  real.exec("CREATE TABLE users (id INTEGER PRIMARY KEY, username TEXT, password_hash TEXT)");
  real.prepare("INSERT INTO users (username, password_hash) VALUES (?, ?)").run(
    "real.person",
    bcrypt.hashSync("x", 4),
  );
  real.close();
  assert.throws(
    () => seedDemo({ dataDir: dir, endDate: END_DATE, log: () => {} }),
    /non-demo users \(real\.person\)/,
  );
  assert.ok(fs.existsSync(path.join(dir, "konto.db")));
  fs.rmSync(dir, { recursive: true, force: true });
});

test("refuses the real data directory", () => {
  assert.throws(
    () => seedDemo({ dataDir: path.join(__dirname, "..", "data"), log: () => {} }),
    /real data directory/,
  );
});
