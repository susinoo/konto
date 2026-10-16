// Starts the app on a temporary database, never on backend/data. Call it
// before anything else requires server.js: configuration is read from
// process.env when the module loads. `node --test` runs each test file in its
// own process, so each file gets a fresh database and fresh rate-limit
// counters.

const fs = require("fs");
const os = require("os");
const path = require("path");
const request = require("supertest");

const SEED_USERNAME = "owner";
const SEED_PASSWORD = "owner-password";

// `prepareDataDir(dir)` can populate the data directory (e.g. with a legacy
// database) before the server opens it.
function loadApp({ env = {}, prepareDataDir } = {}) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "konto-test-"));
  if (prepareDataDir) prepareDataDir(dataDir);
  // Explicit values: dotenv never overrides variables that are already set,
  // so a local backend/.env cannot influence the tests.
  Object.assign(process.env, {
    NODE_ENV: "development",
    KONTO_DATA_DIR: dataDir,
    KONTO_USER: SEED_USERNAME,
    KONTO_PASS: SEED_PASSWORD,
    SESSION_SECRET: "test-secret",
    REGISTRATION_ENABLED: "true",
    TRUST_PROXY: "false",
    KONTO_LOCALE: "en",
    KONTO_CURRENCY: "EUR",
    ...env,
  });
  const { app, db } = require("../server");
  process.on("exit", () => {
    db.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });
  return { app, db, dataDir };
}

async function register(app, username, password = "password123") {
  const agent = request.agent(app);
  const res = await agent
    .post("/api/auth/register")
    .send({ username, password, passwordConfirm: password });
  if (res.status !== 201) throw new Error(`register ${username}: ${res.text}`);
  return agent;
}

async function login(app, username, password) {
  const agent = request.agent(app);
  const res = await agent.post("/api/auth/login").send({ username, password });
  if (res.status !== 200) throw new Error(`login ${username}: ${res.text}`);
  return agent;
}

module.exports = { loadApp, register, login, SEED_USERNAME, SEED_PASSWORD };
