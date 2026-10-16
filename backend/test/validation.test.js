const { test, before } = require("node:test");
const assert = require("node:assert/strict");
const { loadApp, register } = require("./helpers");

const { app } = loadApp();

let agent;

before(async () => {
  agent = await register(app, "carol");
});

const transaction = (fields) => ({
  date: "2026-01-01",
  amountCents: 100,
  categoryName: "Bar",
  ...fields,
});

test("transactions: only real ISO dates are accepted", async () => {
  for (const date of ["2026-02-30", "2026-13-01", "15/01/26", "yesterday", 20260101]) {
    const res = await agent.post("/api/transactions").send(transaction({ date }));
    assert.equal(res.status, 400, String(date));
    assert.equal(res.body.code, "INVALID_DATE");
  }
  const leapDay = await agent.post("/api/transactions").send(transaction({ date: "2024-02-29" }));
  assert.equal(leapDay.status, 201);
  assert.equal(leapDay.body.transaction.date, "2024-02-29");
});

test("transactions: amounts must be non-negative integer cents", async () => {
  for (const amountCents of [12.5, "100", -5, Infinity, 1e15, null]) {
    const res = await agent.post("/api/transactions").send(transaction({ amountCents }));
    assert.equal(res.status, 400, String(amountCents));
  }
  const ok = await agent.post("/api/transactions").send(transaction({ amountCents: 1999 }));
  assert.equal(ok.body.transaction.amountCents, 1999);
});

test("transactions: type comes from the category, description is trimmed or null", async () => {
  const income = await agent
    .post("/api/transactions")
    .send(transaction({ categoryName: "Income", description: "  salary  " }));
  assert.equal(income.body.transaction.type, "income");
  assert.equal(income.body.transaction.description, "salary");
  const expense = await agent
    .post("/api/transactions")
    .send(transaction({ categoryName: "Bar", description: "   " }));
  assert.equal(expense.body.transaction.type, "expense");
  assert.equal(expense.body.transaction.description, null);
});

test("transactions: description too long rejected", async () => {
  const res = await agent
    .post("/api/transactions")
    .send(transaction({ description: "x".repeat(201) }));
  assert.equal(res.body.code, "DESCRIPTION_TOO_LONG");
});

test("categories and accounts: color, name length and type validated", async () => {
  const badColor = await agent
    .post("/api/categories")
    .send({ name: "Test", color: "red; background:url(x)" });
  assert.equal(badColor.body.code, "INVALID_COLOR");
  const badType = await agent.post("/api/categories").send({ name: "Test", type: "other" });
  assert.equal(badType.body.code, "INVALID_TYPE");
  const longName = await agent.post("/api/accounts").send({ name: "x".repeat(51) });
  assert.equal(longName.body.code, "NAME_TOO_LONG");
  const badBalance = await agent
    .post("/api/accounts")
    .send({ name: "Savings", openingBalanceCents: 10.5 });
  assert.equal(badBalance.body.code, "INVALID_OPENING_BALANCE");

  const ok = await agent
    .post("/api/accounts")
    .send({ name: "Savings", color: "#AABBCC", openingBalanceCents: -5050 });
  assert.equal(ok.status, 201);
  assert.equal(ok.body.account.openingBalanceCents, -5050);
});

test("malformed JSON body: 400 without a stack trace", async () => {
  const res = await agent
    .post("/api/categories")
    .set("Content-Type", "application/json")
    .send("{not json");
  assert.equal(res.status, 400);
  assert.equal(res.body.code, "INVALID_JSON");
  assert.ok(!res.text.includes("at "));
});

test("list is sorted by date, filters by year and month, years/months listed", async () => {
  const fresh = await register(app, "dave");
  for (const date of ["2025-12-31", "2026-02-01", "2026-01-15"]) {
    await fresh.post("/api/transactions").send(transaction({ date })).expect(201);
  }
  const all = (await fresh.get("/api/transactions")).body.map((t) => t.date);
  assert.deepEqual(all, ["2026-02-01", "2026-01-15", "2025-12-31"]);

  const january = (await fresh.get("/api/transactions?year=2026&month=1")).body;
  assert.deepEqual(january.map((t) => t.date), ["2026-01-15"]);
  const december = (await fresh.get("/api/transactions?year=2025&month=12")).body;
  assert.deepEqual(december.map((t) => t.date), ["2025-12-31"]);

  assert.deepEqual((await fresh.get("/api/transactions/years")).body, [2026, 2025]);
  assert.deepEqual((await fresh.get("/api/transactions/months?year=2026")).body, [1, 2]);
  assert.equal((await fresh.get("/api/transactions?year=26")).body.code, "INVALID_YEAR");
});

test("dashboard and analytics totals are exact in cents", async () => {
  const fresh = await register(app, "erin");
  const rows = [
    { amountCents: 10, categoryName: "Bar" },
    { amountCents: 20, categoryName: "Bar" },
    { amountCents: 100000, categoryName: "Income" },
  ];
  for (const row of rows) {
    await fresh.post("/api/transactions").send(transaction({ date: "2026-04-10", ...row }));
  }
  const dashboard = (await fresh.get("/api/dashboard?year=2026&month=4")).body;
  assert.deepEqual(
    { ...dashboard.summary },
    { year: 2026, month: 4, count: 3, incomeCents: 100000, expensesCents: 30, netCents: 99970 },
  );
  assert.equal(dashboard.activeAccount.balanceCents, 99970);

  const analytics = (await fresh.get("/api/analytics?year=2026")).body;
  assert.deepEqual(analytics.monthly, [
    { month: 4, incomeCents: 100000, expensesCents: 30, netCents: 99970 },
  ]);
  assert.equal(analytics.monthlyByCategory[4].Bar, 30);
});

test("CSV export: no executable formulas, separators protected, format per locale", async () => {
  await agent.post("/api/categories").send({ name: "=HYPERLINK(1)" }).expect(201);
  await agent
    .post("/api/transactions")
    .send(
      transaction({ date: "2026-05-01", amountCents: 300, categoryName: "=HYPERLINK(1)", description: '+cmd; "x", y' }),
    )
    .expect(201);

  const english = (await agent.get("/api/export/transactions.csv")).text;
  assert.ok(english.startsWith("Date,Amount,Type,Category,Description,Account,Transfer account\n"));
  const englishLine = english.split("\n").find((l) => l.startsWith("2026-05-01"));
  assert.equal(englishLine, `2026-05-01,3.00,expense,'=HYPERLINK(1),"'+cmd; ""x"", y",Main account,`);

  const italian = (await agent.get("/api/export/transactions.csv?locale=it")).text;
  assert.ok(italian.startsWith("Data;Importo;Tipo;Categoria;Descrizione;Conto;Conto collegato\n"));
  const italianLine = italian.split("\n").find((l) => l.startsWith("2026-05-01"));
  assert.equal(italianLine, `2026-05-01;3,00;uscita;'=HYPERLINK(1);"'+cmd; ""x"", y";Main account;`);
});

test("unknown API route: JSON 404", async () => {
  const res = await agent.get("/api/summary?year=2026&month=1");
  assert.equal(res.status, 404);
  assert.equal(res.body.code, "NOT_FOUND");
});
