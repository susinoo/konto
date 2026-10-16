const { test } = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");
const { loadApp, SEED_USERNAME, SEED_PASSWORD } = require("./helpers");

const { app } = loadApp();

test("login: after 10 failed attempts it answers 429, even with the right password", async () => {
  // Successful logins do not count towards the limit
  for (let i = 0; i < 3; i++) {
    await request(app)
      .post("/api/auth/login")
      .send({ username: SEED_USERNAME, password: SEED_PASSWORD })
      .expect(200);
  }
  for (let i = 0; i < 10; i++) {
    await request(app)
      .post("/api/auth/login")
      .send({ username: SEED_USERNAME, password: "wrong" })
      .expect(401);
  }
  const blocked = await request(app)
    .post("/api/auth/login")
    .send({ username: SEED_USERNAME, password: SEED_PASSWORD });
  assert.equal(blocked.status, 429);
  assert.equal(blocked.body.code, "TOO_MANY_LOGIN_ATTEMPTS");
});
