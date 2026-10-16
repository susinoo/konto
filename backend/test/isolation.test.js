// The most important invariant of a multi-user app: a user must never be
// able to read or modify another user's data.

const { test, before } = require("node:test");
const assert = require("node:assert/strict");
const { loadApp, register, login, SEED_USERNAME, SEED_PASSWORD } = require("./helpers");

const { app } = loadApp();

let alice, bob, aliceTransaction, aliceAccount, aliceCategory;

before(async () => {
  alice = await register(app, "alice");
  bob = await register(app, "bob");
  aliceAccount = (await alice.get("/api/accounts")).body[0];
  aliceCategory = (await alice.post("/api/categories").send({ name: "Secret" })).body.category;
  aliceTransaction = (
    await alice.post("/api/transactions").send({
      date: "2026-03-05",
      amountCents: 4200,
      categoryName: "Secret",
      description: "private",
      accountId: aliceAccount.id,
    })
  ).body.transaction;
});

test("reads: bob sees none of alice's transactions, categories or accounts", async () => {
  assert.equal((await bob.get("/api/transactions")).body.length, 0);
  const categories = (await bob.get("/api/categories")).body;
  assert.ok(!categories.some((c) => c.name === "Secret"));
  const accounts = (await bob.get("/api/accounts")).body;
  assert.ok(!accounts.some((a) => a.id === aliceAccount.id));
  const csv = (await bob.get("/api/export/transactions.csv")).text;
  assert.ok(!csv.includes("private"));
});

test("another user's accountId is rejected on reads and writes", async () => {
  for (const url of [
    `/api/transactions?accountId=${aliceAccount.id}`,
    `/api/dashboard?year=2026&month=3&accountId=${aliceAccount.id}`,
    `/api/analytics?year=2026&accountId=${aliceAccount.id}`,
    `/api/transactions/years?accountId=${aliceAccount.id}`,
    `/api/transactions/months?year=2026&accountId=${aliceAccount.id}`,
  ]) {
    const res = await bob.get(url);
    assert.equal(res.status, 400, url);
    assert.equal(res.body.code, "INVALID_ACCOUNT", url);
  }
  const write = await bob.post("/api/transactions").send({
    date: "2026-03-06",
    amountCents: 100,
    categoryName: "Bar",
    accountId: aliceAccount.id,
  });
  assert.equal(write.status, 400);
});

test("writes: bob cannot modify or delete alice's data", async () => {
  const put = await bob
    .put(`/api/transactions/${aliceTransaction.id}`)
    .send({ date: "2026-03-05", amountCents: 0, categoryName: "Bar" });
  assert.equal(put.status, 404);
  assert.equal((await bob.delete(`/api/transactions/${aliceTransaction.id}`)).status, 404);
  assert.equal(
    (await bob.patch(`/api/categories/${aliceCategory.id}`).send({ name: "X" })).status,
    404,
  );
  assert.equal((await bob.delete(`/api/categories/${aliceCategory.id}`)).status, 404);
  assert.equal(
    (await bob.patch(`/api/accounts/${aliceAccount.id}`).send({ name: "X" })).status,
    404,
  );
  assert.equal((await bob.delete(`/api/accounts/${aliceAccount.id}`)).status, 404);

  const transactions = (await alice.get("/api/transactions")).body;
  assert.equal(transactions.length, 1);
  assert.equal(transactions[0].amountCents, 4200);
});

test("full database download: owner only", async () => {
  const denied = await bob.get("/api/export/database");
  assert.equal(denied.status, 403);
  assert.equal(denied.body.code, "FORBIDDEN");
  const owner = await login(app, SEED_USERNAME, SEED_PASSWORD);
  const res = await owner.get("/api/export/database").buffer(true);
  assert.equal(res.status, 200);
  assert.match(res.headers["content-disposition"], /konto\.db/);
});
