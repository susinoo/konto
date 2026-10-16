const { test } = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");
const { loadApp, register, login, SEED_USERNAME, SEED_PASSWORD } = require("./helpers");

const { app, db } = loadApp();

test("first start on an empty database: current schema and the seed owner with defaults", async () => {
  assert.equal(db.pragma("user_version", { simple: true }), 3);
  const agent = await login(app, SEED_USERNAME, SEED_PASSWORD);
  const me = await agent.get("/api/auth/me");
  assert.equal(me.body.user.username, SEED_USERNAME);
  assert.equal(me.body.user.isOwner, true);
  const categories = await agent.get("/api/categories");
  assert.ok(categories.body.some((c) => c.name === "Income" && c.type === "income"));
  const config = await request(app).get("/api/config");
  assert.deepEqual(config.body, { registrationEnabled: true, currency: "EUR" });
  const accounts = await agent.get("/api/accounts");
  assert.equal(accounts.body.length, 1);
  assert.equal(accounts.body[0].isDefault, true);
});

test("registration validates username and password", async () => {
  const badUsername = await request(app)
    .post("/api/auth/register")
    .send({ username: "a b", password: "password123" });
  assert.equal(badUsername.status, 400);
  assert.equal(badUsername.body.code, "INVALID_USERNAME");

  const shortPassword = await request(app)
    .post("/api/auth/register")
    .send({ username: "valid", password: "short" });
  assert.equal(shortPassword.status, 400);
  assert.equal(shortPassword.body.code, "PASSWORD_TOO_SHORT");
});

test("registration rejects a taken username; new users are not owners", async () => {
  const agent = await register(app, "alice");
  const me = await agent.get("/api/auth/me");
  assert.equal(me.body.user.isOwner, false);

  const duplicate = await request(app)
    .post("/api/auth/register")
    .send({ username: "alice", password: "password123" });
  assert.equal(duplicate.status, 400);
  assert.equal(duplicate.body.code, "USERNAME_TAKEN");
});

test("login gives the same answer for a wrong password and an unknown user", async () => {
  const wrongPassword = await request(app)
    .post("/api/auth/login")
    .send({ username: "alice", password: "wrong-password" });
  const unknownUser = await request(app)
    .post("/api/auth/login")
    .send({ username: "nobody", password: "wrong-password" });
  assert.equal(wrongPassword.status, 401);
  assert.equal(unknownUser.status, 401);
  assert.deepEqual(wrongPassword.body, unknownUser.body);
  assert.equal(wrongPassword.body.code, "INVALID_CREDENTIALS");
});

test("login issues a new session id (no session fixation)", async () => {
  const agent = request.agent(app);
  const before = await agent.post("/api/auth/login").send({ username: "x", password: "y" });
  const res = await agent.post("/api/auth/login").send({ username: "alice", password: "password123" });
  assert.equal(res.status, 200);
  const cookie = res.headers["set-cookie"]?.[0] ?? "";
  assert.match(cookie, /konto\.sid=/);
  assert.notEqual(cookie, before.headers["set-cookie"]?.[0]);
});

test("protected routes without a session: 401", async () => {
  for (const url of [
    "/api/categories",
    "/api/transactions",
    "/api/export/transactions.csv",
    "/api/export/database",
  ]) {
    const res = await request(app).get(url);
    assert.equal(res.status, 401, url);
    assert.equal(res.body.code, "UNAUTHORIZED");
  }
});

test("password change invalidates other sessions and keeps the current one", async () => {
  const deviceA = await login(app, "alice", "password123");
  const deviceB = await login(app, "alice", "password123");

  const wrong = await deviceA
    .post("/api/account/change-password")
    .send({ currentPassword: "nope", newPassword: "new-password-1" });
  // 400, not 401: a 401 would force a logout in the frontend
  assert.equal(wrong.status, 400);
  assert.equal(wrong.body.code, "WRONG_PASSWORD");

  const ok = await deviceA.post("/api/account/change-password").send({
    currentPassword: "password123",
    newPassword: "new-password-1",
    newPasswordConfirm: "new-password-1",
  });
  assert.equal(ok.status, 200);

  assert.equal((await deviceA.get("/api/auth/me")).status, 200);
  assert.equal((await deviceB.get("/api/auth/me")).status, 401);
  assert.equal((await deviceB.get("/api/categories")).status, 401);

  await login(app, "alice", "new-password-1");
});

test("account deletion removes the data and invalidates every session", async () => {
  const deviceA = await register(app, "bob");
  const deviceB = await login(app, "bob", "password123");
  await deviceA
    .post("/api/transactions")
    .send({ date: "2026-01-10", amountCents: 1000, categoryName: "Bar" })
    .expect(201);

  const res = await deviceA.post("/api/account/delete").send({ currentPassword: "password123" });
  assert.equal(res.status, 200);
  const remaining = db
    .prepare("SELECT COUNT(*) AS n FROM transactions WHERE user_id NOT IN (SELECT id FROM users)")
    .get().n;
  assert.equal(remaining, 0);

  // The session on the other device must not be able to write anymore
  assert.equal((await deviceB.get("/api/transactions")).status, 401);
  const write = await deviceB
    .post("/api/transactions")
    .send({ date: "2026-01-11", amountCents: 500, categoryName: "Bar" });
  assert.equal(write.status, 401);
});

test("state-changing requests from another origin: 403", async () => {
  const agent = await login(app, SEED_USERNAME, SEED_PASSWORD);
  const res = await agent
    .post("/api/categories")
    .set("Origin", "https://evil.example")
    .send({ name: "Pwned" });
  assert.equal(res.status, 403);
  assert.equal(res.body.code, "INVALID_ORIGIN");
});

test("security headers present, x-powered-by absent", async () => {
  const res = await request(app).get("/api/config");
  assert.ok(res.headers["content-security-policy"]);
  assert.equal(res.headers["x-frame-options"], "SAMEORIGIN");
  assert.equal(res.headers["x-content-type-options"], "nosniff");
  assert.equal(res.headers["x-powered-by"], undefined);
});
