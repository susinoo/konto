// SqliteSessionStore: the express-session store on its own SQLite file.

const { test } = require("node:test");
const assert = require("node:assert/strict");
const Database = require("better-sqlite3");
const { SqliteSessionStore } = require("../sessionStore");
const { loadApp, login, SEED_USERNAME, SEED_PASSWORD } = require("./helpers");

const call = (fn, ...args) =>
  new Promise((resolve, reject) => fn(...args, (err, value) => (err ? reject(err) : resolve(value))));

const inDays = (days) => new Date(Date.now() + days * 86400000).toISOString();
const session = (expires, data = {}) => ({ cookie: { expires, httpOnly: true }, ...data });

function newStore() {
  return new SqliteSessionStore(new Database(":memory:"));
}

test("set, get, destroy", async () => {
  const store = newStore();
  await call(store.set.bind(store), "a", session(inDays(30), { user: { id: 1 } }));
  assert.deepEqual((await call(store.get.bind(store), "a")).user, { id: 1 });
  await call(store.destroy.bind(store), "a");
  assert.equal(await call(store.get.bind(store), "a"), null);
  assert.equal(await call(store.get.bind(store), "missing"), null);
  store.close();
});

test("expired sessions are never returned, and the cleanup deletes them", async () => {
  const store = newStore();
  await call(store.set.bind(store), "old", session(inDays(-1)));
  await call(store.set.bind(store), "new", session(inDays(1)));
  assert.equal(await call(store.get.bind(store), "old"), null);
  assert.equal(store.clearExpired(), 1);
  assert.deepEqual(store.db.prepare("SELECT sid FROM sessions").all(), [{ sid: "new" }]);
  store.close();
});

test("touch only moves the expiry forward", async () => {
  const store = newStore();
  await call(store.set.bind(store), "a", session(inDays(1), { user: { id: 7 } }));
  await call(store.touch.bind(store), "a", session(inDays(30), { user: { id: 999 } }));
  const row = store.db.prepare("SELECT sess, expire FROM sessions WHERE sid = 'a'").get();
  assert.equal(JSON.parse(row.sess).user.id, 7);
  assert.ok(row.expire > inDays(29));
  store.close();
});

test("reads sessions written by the previous store (same table layout)", async () => {
  const db = new Database(":memory:");
  db.exec("CREATE TABLE sessions (sid TEXT NOT NULL PRIMARY KEY, sess JSON NOT NULL, expire TEXT NOT NULL)");
  db.prepare("INSERT INTO sessions VALUES (?, ?, ?)").run(
    "legacy",
    JSON.stringify(session(inDays(10), { user: { id: 3, sessionVersion: 0 } })),
    inDays(10),
  );
  const store = new SqliteSessionStore(db);
  assert.equal((await call(store.get.bind(store), "legacy")).user.id, 3);
  store.close();
});

test("with the app: a logged-in session works and logout removes it", async () => {
  const { app, dataDir } = loadApp();
  const agent = await login(app, SEED_USERNAME, SEED_PASSWORD);
  assert.equal((await agent.get("/api/auth/me")).status, 200);

  const sessions = new Database(`${dataDir}/sessions.db`, { readonly: true });
  const count = () => sessions.prepare("SELECT COUNT(*) AS n FROM sessions").get().n;
  assert.equal(count(), 1);
  await agent.post("/api/auth/logout").expect(200);
  assert.equal(count(), 0);
  assert.equal((await agent.get("/api/auth/me")).status, 401);
  sessions.close();
});
