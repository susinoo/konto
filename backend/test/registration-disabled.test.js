const { test } = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");
const { loadApp, login, SEED_USERNAME, SEED_PASSWORD } = require("./helpers");

// Default behavior for anyone installing the app: registration closed. The
// same instance also checks the KONTO_LOCALE / KONTO_CURRENCY settings.
const { app } = loadApp({
  env: { REGISTRATION_ENABLED: "false", KONTO_LOCALE: "it", KONTO_CURRENCY: "CHF" },
});

test("registration disabled: config says so and /api/auth/register answers 403", async () => {
  const config = await request(app).get("/api/config");
  assert.deepEqual(config.body, { registrationEnabled: false, currency: "CHF" });

  const res = await request(app)
    .post("/api/auth/register")
    .send({ username: "eve", password: "password123" });
  assert.equal(res.status, 403);
  assert.equal(res.body.code, "REGISTRATION_DISABLED");
});

test("KONTO_LOCALE sets the language of the seed user's default data", async () => {
  const owner = await login(app, SEED_USERNAME, SEED_PASSWORD);
  const names = (await owner.get("/api/categories")).body.map((c) => c.name);
  assert.ok(names.includes("Entrata"));
  assert.equal((await owner.get("/api/accounts")).body[0].name, "Conto principale");
});
