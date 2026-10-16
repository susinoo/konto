// Transfers between a user's own accounts: two linked rows that move the
// balances but never count as income or expenses.

const { test, before } = require("node:test");
const assert = require("node:assert/strict");
const { loadApp, register } = require("./helpers");

const { app, db } = loadApp();

let agent, other, main, savings, otherAccount;

before(async () => {
  agent = await register(app, "dana");
  other = await register(app, "erin");
  main = (await agent.get("/api/accounts")).body[0];
  savings = (await agent.post("/api/accounts").send({ name: "Savings", openingBalanceCents: 1000 }))
    .body.account;
  otherAccount = (await other.get("/api/accounts")).body[0];
  await agent
    .post("/api/transactions")
    .send({ date: "2026-04-02", amountCents: 50000, categoryName: "Income", accountId: main.id });
  await agent
    .post("/api/transactions")
    .send({ date: "2026-04-03", amountCents: 2000, categoryName: "Shopping", accountId: main.id });
});

const transfer = (fields) => ({
  date: "2026-04-10",
  amountCents: 30000,
  fromAccountId: main.id,
  toAccountId: savings.id,
  description: "  To savings ",
  ...fields,
});

const balances = async () =>
  Object.fromEntries((await agent.get("/api/accounts")).body.map((a) => [a.id, a.balanceCents]));

test("create: two linked rows, balances move, 201 with the transfer", async () => {
  const before = await balances();
  const res = await agent.post("/api/transfers").send(transfer());
  assert.equal(res.status, 201);
  const created = res.body.transfer;
  assert.deepEqual(
    { ...created, id: undefined },
    {
      id: undefined,
      date: "2026-04-10",
      amountCents: 30000,
      fromAccountId: main.id,
      toAccountId: savings.id,
      description: "To savings",
    },
  );

  const rows = db
    .prepare("SELECT account_id, type, category_name, transfer_id FROM transactions WHERE transfer_id = ? ORDER BY id")
    .all(created.id);
  assert.deepEqual(rows, [
    { account_id: main.id, type: "transfer_out", category_name: null, transfer_id: created.id },
    { account_id: savings.id, type: "transfer_in", category_name: null, transfer_id: created.id },
  ]);

  const after = await balances();
  assert.equal(after[main.id], before[main.id] - 30000);
  assert.equal(after[savings.id], before[savings.id] + 30000);

  await agent.delete(`/api/transfers/${created.id}`).expect(204);
});

test("list: each account sees its row with the counterpart account", async () => {
  const { id } = (await agent.post("/api/transfers").send(transfer())).body.transfer;

  const fromMain = (await agent.get(`/api/transactions?accountId=${main.id}&year=2026&month=4`)).body;
  const out = fromMain.find((t) => t.transferId === id);
  assert.equal(out.type, "transfer_out");
  assert.equal(out.categoryName, null);
  assert.equal(out.counterpartAccountId, savings.id);

  const all = (await agent.get("/api/transactions?year=2026&month=4")).body;
  const pair = all.filter((t) => t.transferId === id);
  assert.deepEqual(pair.map((t) => [t.type, t.accountId, t.counterpartAccountId]).sort(), [
    ["transfer_in", savings.id, main.id],
    ["transfer_out", main.id, savings.id],
  ]);

  await agent.delete(`/api/transfers/${id}`).expect(204);
});

test("totals: transfers are neither income nor expenses, nor a category", async () => {
  const { id } = (await agent.post("/api/transfers").send(transfer())).body.transfer;

  const dashboard = (await agent.get(`/api/dashboard?year=2026&month=4&accountId=${main.id}`)).body;
  assert.equal(dashboard.summary.incomeCents, 50000);
  assert.equal(dashboard.summary.expensesCents, 2000);
  assert.ok(dashboard.breakdown.every((row) => row.categoryName !== null));
  assert.ok(dashboard.recent.some((t) => t.transferId === id));

  const analytics = (await agent.get("/api/analytics?year=2026")).body;
  const april = analytics.monthly.find((m) => m.month === 4);
  assert.deepEqual([april.incomeCents, april.expensesCents], [50000, 2000]);
  assert.ok(analytics.categoryTotals.every((row) => row.categoryName !== null));
  assert.ok(!("null" in analytics.monthlyByCategory[4]));

  await agent.delete(`/api/transfers/${id}`).expect(204);
});

test("update: both rows change together, accounts can be swapped", async () => {
  const { id } = (await agent.post("/api/transfers").send(transfer())).body.transfer;
  const before = await balances();

  const res = await agent.put(`/api/transfers/${id}`).send(
    transfer({ date: "2026-04-12", amountCents: 1000, fromAccountId: savings.id, toAccountId: main.id, description: "" }),
  );
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.transfer, {
    id,
    date: "2026-04-12",
    amountCents: 1000,
    fromAccountId: savings.id,
    toAccountId: main.id,
    description: null,
  });

  const after = await balances();
  assert.equal(after[main.id], before[main.id] + 30000 + 1000);
  assert.equal(after[savings.id], before[savings.id] - 30000 - 1000);

  await agent.delete(`/api/transfers/${id}`).expect(204);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM transactions WHERE transfer_id = ?").get(id).n, 0);
});

test("validation: same account, zero amount, missing fields, foreign accounts", async () => {
  const cases = [
    [transfer({ toAccountId: main.id }), "SAME_ACCOUNT"],
    [transfer({ amountCents: 0 }), "INVALID_AMOUNT"],
    [transfer({ amountCents: -100 }), "INVALID_AMOUNT"],
    [transfer({ date: "2026-02-30" }), "INVALID_DATE"],
    [transfer({ toAccountId: undefined }), "MISSING_FIELDS"],
    [transfer({ toAccountId: otherAccount.id }), "INVALID_ACCOUNT"],
    [transfer({ description: "x".repeat(201) }), "DESCRIPTION_TOO_LONG"],
  ];
  for (const [body, code] of cases) {
    const res = await agent.post("/api/transfers").send(body);
    assert.equal(res.status, 400, code);
    assert.equal(res.body.code, code);
  }
});

test("transfer rows cannot be edited or deleted one at a time", async () => {
  const { id } = (await agent.post("/api/transfers").send(transfer())).body.transfer;
  const row = (await agent.get(`/api/transactions?accountId=${savings.id}`)).body.find(
    (t) => t.transferId === id,
  );

  const put = await agent
    .put(`/api/transactions/${row.id}`)
    .send({ date: "2026-04-10", amountCents: 1, categoryName: "Shopping" });
  assert.equal(put.status, 400);
  assert.equal(put.body.code, "IS_TRANSFER");
  const del = await agent.delete(`/api/transactions/${row.id}`);
  assert.equal(del.status, 400);
  assert.equal(del.body.code, "IS_TRANSFER");

  // An account with transfers is an account with transactions.
  const delAccount = await agent.delete(`/api/accounts/${savings.id}`);
  assert.equal(delAccount.body.code, "ACCOUNT_HAS_TRANSACTIONS");

  await agent.delete(`/api/transfers/${id}`).expect(204);
});

test("isolation: another user cannot read, change or delete a transfer", async () => {
  const { id } = (await agent.post("/api/transfers").send(transfer())).body.transfer;
  // With dana's accounts in the body, erin's request fails on ownership.
  assert.equal((await other.put(`/api/transfers/${id}`).send(transfer())).body.code, "INVALID_ACCOUNT");
  const otherSecond = (await other.post("/api/accounts").send({ name: "Second" })).body.account;
  const put = await other
    .put(`/api/transfers/${id}`)
    .send(transfer({ fromAccountId: otherAccount.id, toAccountId: otherSecond.id }));
  assert.equal(put.status, 404);
  assert.equal((await other.delete(`/api/transfers/${id}`)).status, 404);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM transactions WHERE transfer_id = ?").get(id).n, 2);
  await agent.delete(`/api/transfers/${id}`).expect(204);
});

test("CSV export: transfer rows with their type and counterpart account", async () => {
  const { id } = (await agent.post("/api/transfers").send(transfer({ date: "2026-04-20" }))).body.transfer;
  const english = (await agent.get("/api/export/transactions.csv")).text.split("\n");
  assert.equal(english[0], "Date,Amount,Type,Category,Description,Account,Transfer account");
  const lines = english.filter((l) => l.startsWith("2026-04-20")).sort();
  assert.deepEqual(lines, [
    "2026-04-20,300.00,transfer in,,To savings,Savings,Main account",
    "2026-04-20,300.00,transfer out,,To savings,Main account,Savings",
  ]);
  const italian = (await agent.get("/api/export/transactions.csv?locale=it")).text;
  assert.ok(italian.includes("2026-04-20;300,00;giroconto in uscita;;To savings;Main account;Savings"));
  await agent.delete(`/api/transfers/${id}`).expect(204);
});

test("database constraints: a transfer row needs a transfer_id and no category", () => {
  const insert = (type, category, transferId) => () =>
    db
      .prepare(
        `INSERT INTO transactions (user_id, account_id, date, amount_cents, type, category_name, transfer_id)
         VALUES (99, 99, '2026-01-01', 1, ?, ?, ?)`,
      )
      .run(type, category, transferId);
  assert.throws(insert("transfer_in", null, null), /CHECK/);
  assert.throws(insert("transfer_in", "Bar", 1), /CHECK/);
  assert.throws(insert("expense", null, null), /CHECK/);
  assert.throws(insert("expense", "Bar", 1), /CHECK/);
});
