const { test } = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");
const { loadApp } = require("./helpers");

const { app } = loadApp();

test("default categories and account follow the registration language", async () => {
  const italian = request.agent(app);
  await italian
    .post("/api/auth/register")
    .send({ username: "giulia", password: "password123", locale: "it" })
    .expect(201);
  const italianCategories = (await italian.get("/api/categories")).body.map((c) => c.name);
  assert.ok(italianCategories.includes("Entrata") && italianCategories.includes("Svago"));
  assert.equal((await italian.get("/api/accounts")).body[0].name, "Conto principale");

  // Missing or unsupported locale: English
  const other = request.agent(app);
  await other
    .post("/api/auth/register")
    .send({ username: "pierre", password: "password123", locale: "fr" })
    .expect(201);
  const otherCategories = (await other.get("/api/categories")).body.map((c) => c.name);
  assert.ok(otherCategories.includes("Income") && otherCategories.includes("Leisure"));
  assert.equal((await other.get("/api/accounts")).body[0].name, "Main account");
});
