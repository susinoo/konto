// Load .env from an explicit path rather than the process working directory:
// PM2 and other process managers may start the process from a different
// directory, and dotenv would then silently find nothing.
require("dotenv").config({
  path: require("path").join(__dirname, ".env"),
  quiet: true,
});

const express = require("express");
const compression = require("compression");
const helmet = require("helmet");
const { rateLimit } = require("express-rate-limit");
const path = require("path");
const fs = require("fs");
const https = require("https");
const http = require("http");
const Database = require("better-sqlite3");
const session = require("express-session");
const bcrypt = require("bcryptjs");

const {
  prepareDataDir,
  openDatabase,
  normalizeLocale,
  seedDefaultCategories,
  seedDefaultAccount,
  insertTransfer,
  DEFAULT_COLOR,
} = require("./db");
const { SqliteSessionStore } = require("./sessionStore");

const app = express();

// ============================================================================
// CONFIG
// ============================================================================
const isDev = process.env.NODE_ENV === "development";
const PORT = process.env.PORT || (isDev ? 3000 : 8443);
// Interface to listen on. Unset = all interfaces (as before). Set it to
// 127.0.0.1 when a local proxy (e.g. `tailscale serve`) handles HTTPS, so
// the plain HTTP port is not reachable from the network.
const HOST = process.env.HOST || undefined;

// Seed user, created only when the users table is empty.
const SEED_USERNAME = process.env.KONTO_USER || "admin";
const SEED_PASSWORD = process.env.KONTO_PASS || (isDev ? "dev-password" : null);

const SESSION_SECRET =
  process.env.SESSION_SECRET || (isDev ? "dev-insecure-secret" : null);
const SESSION_MAX_AGE_DAYS = Number(process.env.SESSION_MAX_AGE_DAYS || 30);

if (!isDev && (!SEED_PASSWORD || !SESSION_SECRET)) {
  throw new Error("KONTO_PASS and SESSION_SECRET must be set in backend/.env in production.");
}
const SESSION_MAX_AGE_MS = Math.max(1, SESSION_MAX_AGE_DAYS) * 24 * 60 * 60 * 1000;

// Self-service registration is off unless explicitly enabled, so a fresh
// install is never open to whoever can reach the URL.
const REGISTRATION_ENABLED = process.env.REGISTRATION_ENABLED === "true";

// Only needed behind a reverse proxy that terminates TLS; otherwise
// req.secure and req.ip would not reflect the real client. Accepts Express
// values: "true", a hop count, "loopback", or a list of IPs/subnets.
function parseTrustProxy(value) {
  if (value === undefined || value === "" || value === "false") return false;
  if (value === "true") return true;
  if (/^\d+$/.test(value)) return Number(value);
  return value;
}
const TRUST_PROXY = parseTrustProxy(process.env.TRUST_PROXY);

// Language of the seed user's default categories and account ("en" or "it").
// Users who register later get them in the language of their browser.
const DEFAULT_LOCALE = normalizeLocale(process.env.KONTO_LOCALE);

// Currency of the whole instance (ISO 4217 code), used by the frontend to
// format amounts. Amounts themselves are stored in cents without a currency.
const CURRENCY = /^[A-Z]{3}$/.test(process.env.KONTO_CURRENCY ?? "")
  ? process.env.KONTO_CURRENCY
  : "EUR";

const frontendDistPath = path.join(__dirname, "../frontend/dist");

const certPath = process.env.SSL_CERT_PATH || path.join(__dirname, "server.crt");
const keyPath = process.env.SSL_KEY_PATH || path.join(__dirname, "server.key");

const BCRYPT_ROUNDS = 10;

// ============================================================================
// DATABASE
// ============================================================================
// KONTO_DATA_DIR points to another directory (the tests use a temporary one,
// never the real data).
const { dataDir, dbPath, sessionsDbPath } = prepareDataDir({
  dataDir: process.env.KONTO_DATA_DIR,
});
const db = openDatabase({
  dbPath,
  dataDir,
  seedUsername: String(SEED_USERNAME),
  getSeedPasswordHash: () => bcrypt.hashSync(String(SEED_PASSWORD), BCRYPT_ROUNDS),
  seedLocale: DEFAULT_LOCALE,
});

// ============================================================================
// ERRORS
// ============================================================================
// Errors are returned as { ok: false, code, message }. The frontend shows a
// translated text for `code`; `message` is an English fallback for logs and
// API clients.
const ERROR_MESSAGES = {
  ACCOUNT_EXISTS: "An account with this name already exists",
  ACCOUNT_HAS_TRANSACTIONS: "An account with transactions cannot be deleted",
  CATEGORY_EXISTS: "A category with this name already exists",
  DESCRIPTION_TOO_LONG: "The description is too long",
  FORBIDDEN: "Forbidden",
  INTERNAL_ERROR: "Internal server error",
  INVALID_ACCOUNT: "Invalid account",
  INVALID_AMOUNT: "Invalid amount",
  INVALID_CATEGORY: "Invalid category",
  INVALID_COLOR: "Invalid color",
  INVALID_CREDENTIALS: "Invalid username or password",
  INVALID_DATE: "Invalid date",
  INVALID_JSON: "Invalid JSON body",
  INVALID_MONTH: "Invalid month",
  INVALID_OPENING_BALANCE: "Invalid opening balance",
  INVALID_ORIGIN: "Request origin not allowed",
  INVALID_TYPE: "Invalid type",
  INVALID_USERNAME: "Usernames must be 3-32 characters: letters, digits, dot, dash, underscore",
  INVALID_YEAR: "Invalid year",
  IS_TRANSFER: "This transaction is part of a transfer: use /api/transfers",
  LAST_ACCOUNT: "You cannot delete your only account",
  LAST_INCOME_CATEGORY: "You cannot delete your last income category",
  MISSING_FIELDS: "Required fields are missing",
  NAME_REQUIRED: "Name is required",
  NAME_TOO_LONG: "The name is too long",
  NO_ACCOUNT: "No account available",
  NOT_FOUND: "Not found",
  NOTHING_TO_UPDATE: "No fields to update",
  PASSWORD_TOO_LONG: "The password is too long",
  PASSWORD_TOO_SHORT: "The password is too short",
  PASSWORDS_DO_NOT_MATCH: "The passwords do not match",
  PAYLOAD_TOO_LARGE: "Request body too large",
  REGISTRATION_DISABLED: "Registration is disabled",
  SAME_ACCOUNT: "The source and target accounts must be different",
  TOO_MANY_LOGIN_ATTEMPTS: "Too many login attempts, try again later",
  TOO_MANY_REGISTRATIONS: "Too many registrations from this address, try again later",
  TOO_MANY_REQUESTS: "Too many attempts, try again later",
  UNAUTHORIZED: "Not authenticated",
  USERNAME_TAKEN: "This username is already taken",
  WRONG_PASSWORD: "The current password is incorrect",
};

function errorBody(code) {
  return { ok: false, code, message: ERROR_MESSAGES[code] };
}

function sendError(res, status, code) {
  return res.status(status).json(errorBody(code));
}

function isUniqueViolation(err) {
  return err?.code === "SQLITE_CONSTRAINT_UNIQUE";
}

// ============================================================================
// VALIDATION
// ============================================================================
const MAX_NAME_LENGTH = 50; // category and account names
const MAX_DESCRIPTION_LENGTH = 200;
const MAX_AMOUNT_CENTS = 100_000_000_000; // 1 billion in currency units
const USERNAME_PATTERN = /^[A-Za-z0-9._-]{3,32}$/;
const COLOR_PATTERN = /^#[0-9A-Fa-f]{6}$/;
const ISO_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const MIN_PASSWORD_LENGTH = 8;
// bcrypt only uses the first 72 bytes: longer passwords would be silently
// truncated, so they are rejected instead.
const MAX_PASSWORD_BYTES = 72;
const TRANSACTION_TYPES = ["income", "expense"];

// Each validator returns an error code, or null when the value is valid.
function validatePassword(password) {
  if (typeof password !== "string" || password.length < MIN_PASSWORD_LENGTH)
    return "PASSWORD_TOO_SHORT";
  if (Buffer.byteLength(password, "utf8") > MAX_PASSWORD_BYTES) return "PASSWORD_TOO_LONG";
  return null;
}

function validateName(name) {
  if (typeof name !== "string" || !name.trim()) return "NAME_REQUIRED";
  if (name.length > MAX_NAME_LENGTH) return "NAME_TOO_LONG";
  return null;
}

function isValidColor(color) {
  return typeof color === "string" && COLOR_PATTERN.test(color);
}

function isValidIsoDate(value) {
  const match = ISO_DATE_PATTERN.exec(String(value));
  if (!match) return false;
  const [, year, month, day] = match.map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function isValidCents(value, { allowNegative = false } = {}) {
  return (
    Number.isSafeInteger(value) &&
    Math.abs(value) <= MAX_AMOUNT_CENTS &&
    (allowNegative || value >= 0)
  );
}

function parseYear(value) {
  return /^\d{4}$/.test(String(value)) ? Number(value) : null;
}

function parseMonth(value) {
  const month = Number(value);
  return Number.isInteger(month) && month >= 1 && month <= 12 ? month : null;
}

// Half-open [from, to) ISO date range for a year or a month. Comparing the
// date column against a range (instead of extracting parts) uses the index.
function periodRange(year, month) {
  const pad = (n) => String(n).padStart(2, "0");
  if (!month) return [`${year}-01-01`, `${year + 1}-01-01`];
  const next = month === 12 ? [year + 1, 1] : [year, month + 1];
  return [`${year}-${pad(month)}-01`, `${next[0]}-${pad(next[1])}-01`];
}

// Shared validation for POST and PUT /api/transactions. Returns { error } or
// the normalized fields.
function parseTransactionBody(body) {
  const { date, amountCents, categoryName, description } = body;
  if (date === undefined || amountCents === undefined || !categoryName)
    return { error: "MISSING_FIELDS" };
  if (!isValidIsoDate(date)) return { error: "INVALID_DATE" };
  if (!isValidCents(amountCents)) return { error: "INVALID_AMOUNT" };
  if (typeof categoryName !== "string" || categoryName.length > MAX_NAME_LENGTH)
    return { error: "INVALID_CATEGORY" };
  if (description != null && String(description).length > MAX_DESCRIPTION_LENGTH)
    return { error: "DESCRIPTION_TOO_LONG" };
  return {
    date,
    amountCents,
    categoryName,
    description: description ? String(description).trim() || null : null,
  };
}

// Validation for POST and PUT /api/transfers (ownership of the accounts is
// checked by the route). Returns { error } or the normalized fields.
function parseTransferBody(body) {
  const { date, amountCents, fromAccountId, toAccountId, description } = body;
  if (date === undefined || amountCents === undefined || !fromAccountId || !toAccountId)
    return { error: "MISSING_FIELDS" };
  if (!isValidIsoDate(date)) return { error: "INVALID_DATE" };
  if (!isValidCents(amountCents) || amountCents === 0) return { error: "INVALID_AMOUNT" };
  if (String(fromAccountId) === String(toAccountId)) return { error: "SAME_ACCOUNT" };
  if (description != null && String(description).length > MAX_DESCRIPTION_LENGTH)
    return { error: "DESCRIPTION_TOO_LONG" };
  return {
    date,
    amountCents,
    fromAccountId: Number(fromAccountId),
    toAccountId: Number(toAccountId),
    description: description ? String(description).trim() || null : null,
  };
}

// ============================================================================
// ROW MAPPERS (snake_case columns → camelCase API fields)
// ============================================================================
function toPublicUser(row) {
  return { id: row.id, username: row.username, isOwner: !!row.is_owner };
}

function toCategory(row) {
  return { id: row.id, name: row.name, color: row.color, type: row.type };
}

function toAccount(row) {
  return {
    id: row.id,
    name: row.name,
    color: row.color,
    openingBalanceCents: row.opening_balance_cents,
    balanceCents: row.balance_cents ?? row.opening_balance_cents,
    isDefault: !!row.is_default,
  };
}

// Rows come from TRANSACTIONS_SELECT. For transfers, categoryName is null
// and counterpartAccountId is the account on the other side.
function toTransaction(row) {
  return {
    id: row.id,
    date: row.date,
    amountCents: row.amount_cents,
    type: row.type,
    categoryName: row.category_name,
    description: row.description,
    accountId: row.account_id,
    transferId: row.transfer_id ?? null,
    counterpartAccountId: row.counterpart_account_id ?? null,
  };
}

// A transfer as one object, built from its transfer_out row.
function toTransfer(row) {
  return {
    id: row.transfer_id,
    date: row.date,
    amountCents: row.amount_cents,
    fromAccountId: row.account_id,
    toAccountId: row.counterpart_account_id,
    description: row.description,
  };
}

// ============================================================================
// MIDDLEWARE
// ============================================================================
app.disable("x-powered-by");
app.set("trust proxy", TRUST_PROXY);

// Security headers. The frontend is same-origin and loads no external
// resources, so helmet's default 'self' CSP is enough.
// upgrade-insecure-requests is disabled because the app may run over plain
// HTTP inside an already-encrypted private network (e.g. Tailscale).
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: { upgradeInsecureRequests: null },
    },
  }),
);
app.use(compression());
app.use(express.json({ limit: "100kb" }));
// Express 5 leaves req.body undefined without a JSON body: default it to {}
// so destructuring in route handlers never throws.
app.use((req, res, next) => {
  if (req.body === undefined) req.body = {};
  next();
});

// CSRF defense in depth (on top of SameSite=Lax and JSON-only bodies):
// state-changing requests must come from the app's own origin. Browsers
// always send Origin on cross-origin requests; non-browser clients (curl)
// usually don't, and are allowed.
app.use((req, res, next) => {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return next();
  const origin = req.get("origin");
  if (!origin) return next();
  let originHost;
  try {
    originHost = new URL(origin).host;
  } catch {
    return sendError(res, 403, "INVALID_ORIGIN");
  }
  if (originHost !== req.host) return sendError(res, 403, "INVALID_ORIGIN");
  next();
});

const sessionStore = new SqliteSessionStore(new Database(sessionsDbPath));
app.use(
  session({
    name: "konto.sid",
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    rolling: true, // every request extends the session
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      // "auto": Secure whenever the request arrives over HTTPS (directly, or
      // through a proxy trusted via TRUST_PROXY). A fixed `true` would
      // silently break login over plain HTTP.
      secure: "auto",
      maxAge: SESSION_MAX_AGE_MS,
    },
    store: sessionStore,
  }),
);

// Besides the session itself, checks on every request that the user still
// exists and that the session was not invalidated by a password change or
// reset (session_version). Sessions created before session_version existed
// have no version and count as 0.
function sessionIsValid(req) {
  const sessionUser = req.session?.user;
  if (!sessionUser?.id) return false;
  const row = db.prepare("SELECT session_version FROM users WHERE id = ?").get(sessionUser.id);
  return !!row && row.session_version === (sessionUser.sessionVersion ?? 0);
}

function requireAuth(req, res, next) {
  if (sessionIsValid(req)) return next();
  const unauthorized = () => sendError(res, 401, "UNAUTHORIZED");
  if (req.session?.user) return req.session.destroy(unauthorized);
  return unauthorized();
}

function getUserId(req) {
  return req.session.user.id;
}

// ============================================================================
// FRONTEND STATIC FILES
// ============================================================================
// Vite gives assets content-hashed names: they can be cached forever.
app.use(
  "/assets",
  express.static(path.join(frontendDistPath, "assets"), { maxAge: "1y", immutable: true }),
);
// index.html, manifest and icons: no aggressive caching, so a new deploy is
// picked up without clearing the browser cache.
app.use(express.static(frontendDistPath));

// ============================================================================
// DOMAIN HELPERS
// ============================================================================
function isOwner(userId) {
  return !!db.prepare("SELECT is_owner FROM users WHERE id = ?").get(userId)?.is_owner;
}

// Any accountId coming from the client must belong to the logged-in user.
function accountBelongsToUser(accountId, userId) {
  return !!db.prepare("SELECT 1 FROM accounts WHERE id = ? AND user_id = ?").get(accountId, userId);
}

// Used when the client does not pick an account: the user's default one.
// Returns null only if the user has no account at all.
function getDefaultAccountId(userId) {
  return (
    db
      .prepare("SELECT id FROM accounts WHERE user_id = ? ORDER BY is_default DESC, id ASC LIMIT 1")
      .get(userId)?.id ?? null
  );
}

// The transaction type is frozen from the chosen category at write time. An
// unknown (e.g. just deleted) category defaults to 'expense'.
function getCategoryType(userId, categoryName) {
  const row = db
    .prepare("SELECT type FROM categories WHERE user_id = ? AND name = ?")
    .get(userId, categoryName);
  return row?.type === "income" ? "income" : "expense";
}

// Optional account filter: empty when accountId is absent (all accounts),
// null when the account does not belong to the user.
function accountFilter(accountId, userId, column = "account_id") {
  if (!accountId) return { sql: "", params: [] };
  if (!accountBelongsToUser(accountId, userId)) return null;
  return { sql: `AND ${column} = ?`, params: [accountId] };
}

// Transactions with, for transfers, the account of the other row of the
// pair. Columns of the main table are aliased `t`.
const TRANSACTIONS_SELECT = `
  SELECT t.*, c.account_id AS counterpart_account_id
  FROM transactions t
  LEFT JOIN transactions c ON c.transfer_id = t.transfer_id AND c.id <> t.id
`;

// Kept out of category breakdowns: transfers have no category.
const NOT_TRANSFER_SQL = "AND transfer_id IS NULL";

// Running balance: opening balance plus ALL the account's transactions to
// date, regardless of the selected period (like a home-banking balance).
const ACCOUNTS_WITH_BALANCE_SQL = `
  SELECT a.*,
    a.opening_balance_cents + COALESCE(SUM(
      CASE WHEN t.type IN ('income', 'transfer_in') THEN t.amount_cents ELSE -t.amount_cents END
    ), 0) AS balance_cents
  FROM accounts a
  LEFT JOIN transactions t ON t.account_id = a.id
  WHERE a.user_id = ?
  GROUP BY a.id
  ORDER BY a.name ASC
`;

// Income and expenses only: transfers move money between the user's own
// accounts and are neither.
const TOTALS_SQL = `
  COALESCE(SUM(CASE WHEN type = 'income' THEN amount_cents ELSE 0 END), 0) AS income_cents,
  COALESCE(SUM(CASE WHEN type = 'expense' THEN amount_cents ELSE 0 END), 0) AS expenses_cents
`;

// ============================================================================
// PUBLIC ROUTES
// ============================================================================
// In-memory, per-IP rate limits against password guessing and registration
// floods. For login and password confirmations only failures count.
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  skipSuccessfulRequests: true,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: errorBody("TOO_MANY_LOGIN_ATTEMPTS"),
});
const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 5,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: errorBody("TOO_MANY_REGISTRATIONS"),
});
const passwordCheckLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  skipSuccessfulRequests: true,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: errorBody("TOO_MANY_REQUESTS"),
});

// Compared when the username does not exist, so that the response time does
// not reveal which usernames are registered.
const DUMMY_PASSWORD_HASH = bcrypt.hashSync("konto-dummy-password", BCRYPT_ROUNDS);

// A new session id at every login/registration prevents session fixation.
function startSession(req, row) {
  return new Promise((resolve, reject) => {
    req.session.regenerate((err) => {
      if (err) return reject(err);
      req.session.user = { ...toPublicUser(row), sessionVersion: row.session_version ?? 0 };
      resolve();
    });
  });
}

// Public: the frontend reads it before login (whether to show "Sign up",
// which currency to format amounts in).
app.get("/api/config", (req, res) => {
  res.json({ registrationEnabled: REGISTRATION_ENABLED, currency: CURRENCY });
});

app.post("/api/auth/login", loginLimiter, async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return sendError(res, 400, "MISSING_FIELDS");

  const row = db
    .prepare(
      "SELECT id, username, password_hash, is_owner, session_version FROM users WHERE username = ?",
    )
    .get(String(username));
  const passwordMatches = await bcrypt.compare(
    String(password),
    row ? row.password_hash : DUMMY_PASSWORD_HASH,
  );
  if (!row || !passwordMatches) return sendError(res, 401, "INVALID_CREDENTIALS");

  await startSession(req, row);
  res.json({ ok: true, user: toPublicUser(row) });
});

app.post("/api/auth/register", registerLimiter, async (req, res) => {
  if (!REGISTRATION_ENABLED) return sendError(res, 403, "REGISTRATION_DISABLED");

  const { passwordConfirm } = req.body;
  // Language of the new user's default categories and account; unknown or
  // missing values fall back to English.
  const locale = normalizeLocale(req.body.locale);
  const username = String(req.body.username ?? "").trim();
  const password = String(req.body.password ?? "");

  if (!username || !password) return sendError(res, 400, "MISSING_FIELDS");
  if (!USERNAME_PATTERN.test(username)) return sendError(res, 400, "INVALID_USERNAME");
  const passwordError = validatePassword(password);
  if (passwordError) return sendError(res, 400, passwordError);
  if (passwordConfirm !== undefined && password !== passwordConfirm)
    return sendError(res, 400, "PASSWORDS_DO_NOT_MATCH");
  if (db.prepare("SELECT 1 FROM users WHERE username = ?").get(username))
    return sendError(res, 400, "USERNAME_TAKEN");

  const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
  let userId;
  try {
    db.transaction(() => {
      userId = db
        .prepare("INSERT INTO users (username, password_hash) VALUES (?, ?)")
        .run(username, passwordHash).lastInsertRowid;
      seedDefaultCategories(db, userId, locale);
      seedDefaultAccount(db, userId, locale);
    })();
  } catch (err) {
    // Two concurrent registrations with the same username: the check above
    // passes for both, the UNIQUE constraint stops the second one.
    if (isUniqueViolation(err)) return sendError(res, 400, "USERNAME_TAKEN");
    throw err;
  }

  const row = { id: userId, username, is_owner: 0, session_version: 0 };
  await startSession(req, row);
  res.status(201).json({ ok: true, user: toPublicUser(row) });
});

app.get("/api/auth/me", (req, res) => {
  if (!sessionIsValid(req)) return sendError(res, 401, "UNAUTHORIZED");
  // Read from the database, not the session: is_owner can change at any time
  // through scripts/set-owner.js.
  const row = db.prepare("SELECT id, username, is_owner FROM users WHERE id = ?").get(getUserId(req));
  res.json({ ok: true, user: toPublicUser(row) });
});

app.post("/api/auth/logout", (req, res) => {
  req.session.destroy(() => {
    res.clearCookie("konto.sid");
    res.json({ ok: true });
  });
});

// ============================================================================
// PROTECTED ROUTES
// ============================================================================
app.use("/api", requireAuth);

// ---- Account (the logged-in user's own profile)
// Authenticated routes answer 400, not 401, to in-session validation errors
// such as a wrong current password: the frontend treats any 401 as an
// expired session and logs the user out.
app.post("/api/account/change-password", passwordCheckLimiter, async (req, res) => {
  const { currentPassword, newPassword, newPasswordConfirm } = req.body;
  const userId = getUserId(req);

  if (!currentPassword || !newPassword) return sendError(res, 400, "MISSING_FIELDS");
  const passwordError = validatePassword(String(newPassword));
  if (passwordError) return sendError(res, 400, passwordError);
  if (newPasswordConfirm !== undefined && newPassword !== newPasswordConfirm)
    return sendError(res, 400, "PASSWORDS_DO_NOT_MATCH");

  const row = db.prepare("SELECT password_hash, session_version FROM users WHERE id = ?").get(userId);
  if (!(await bcrypt.compare(String(currentPassword), row.password_hash)))
    return sendError(res, 400, "WRONG_PASSWORD");

  // Bumping session_version invalidates the sessions on other devices; the
  // current one is updated and stays valid.
  const passwordHash = await bcrypt.hash(String(newPassword), BCRYPT_ROUNDS);
  const newVersion = row.session_version + 1;
  db.prepare("UPDATE users SET password_hash = ?, session_version = ? WHERE id = ?").run(
    passwordHash,
    newVersion,
    userId,
  );
  req.session.user.sessionVersion = newVersion;
  res.json({ ok: true });
});

app.post("/api/account/delete", passwordCheckLimiter, async (req, res) => {
  const { currentPassword } = req.body;
  const userId = getUserId(req);
  if (!currentPassword) return sendError(res, 400, "MISSING_FIELDS");

  const row = db.prepare("SELECT password_hash FROM users WHERE id = ?").get(userId);
  if (!(await bcrypt.compare(String(currentPassword), row.password_hash)))
    return sendError(res, 400, "WRONG_PASSWORD");

  // No foreign keys are declared: children are deleted before the parent.
  // The owner role is never reassigned automatically (see set-owner.js).
  db.transaction(() => {
    db.prepare("DELETE FROM transactions WHERE user_id = ?").run(userId);
    db.prepare("DELETE FROM categories WHERE user_id = ?").run(userId);
    db.prepare("DELETE FROM accounts WHERE user_id = ?").run(userId);
    db.prepare("DELETE FROM users WHERE id = ?").run(userId);
  })();

  req.session.destroy(() => {
    res.clearCookie("konto.sid");
    res.json({ ok: true });
  });
});

// ---- Categories
app.get("/api/categories", (req, res) => {
  const rows = db
    .prepare("SELECT * FROM categories WHERE user_id = ? ORDER BY name ASC")
    .all(getUserId(req));
  res.json(rows.map(toCategory));
});

app.post("/api/categories", (req, res) => {
  const userId = getUserId(req);
  const { name, color, type = "expense" } = req.body;
  const nameError = validateName(name);
  if (nameError) return sendError(res, 400, nameError);
  if (color !== undefined && !isValidColor(color)) return sendError(res, 400, "INVALID_COLOR");
  if (!TRANSACTION_TYPES.includes(type)) return sendError(res, 400, "INVALID_TYPE");

  try {
    const id = db
      .prepare("INSERT INTO categories (user_id, name, color, type) VALUES (?, ?, ?, ?)")
      .run(userId, name.trim(), color ?? DEFAULT_COLOR, type).lastInsertRowid;
    const row = db.prepare("SELECT * FROM categories WHERE id = ?").get(id);
    res.status(201).json({ ok: true, category: toCategory(row) });
  } catch (err) {
    if (isUniqueViolation(err)) return sendError(res, 400, "CATEGORY_EXISTS");
    throw err;
  }
});

// The type (income/expense) is fixed at creation; only name and color can
// change. Renaming does not touch past transactions (category_name snapshot).
app.patch("/api/categories/:id", (req, res) => {
  const userId = getUserId(req);
  const { name, color } = req.body;
  if (name === undefined && color === undefined) return sendError(res, 400, "NOTHING_TO_UPDATE");
  if (name !== undefined) {
    const nameError = validateName(name);
    if (nameError) return sendError(res, 400, nameError);
  }
  if (color !== undefined && !isValidColor(color)) return sendError(res, 400, "INVALID_COLOR");

  const existing = db
    .prepare("SELECT * FROM categories WHERE id = ? AND user_id = ?")
    .get(req.params.id, userId);
  if (!existing) return sendError(res, 404, "NOT_FOUND");

  try {
    db.prepare("UPDATE categories SET name = ?, color = ? WHERE id = ? AND user_id = ?").run(
      name?.trim() ?? existing.name,
      color ?? existing.color,
      existing.id,
      userId,
    );
  } catch (err) {
    if (isUniqueViolation(err)) return sendError(res, 400, "CATEGORY_EXISTS");
    throw err;
  }
  const row = db.prepare("SELECT * FROM categories WHERE id = ?").get(existing.id);
  res.json({ ok: true, category: toCategory(row) });
});

app.delete("/api/categories/:id", (req, res) => {
  const userId = getUserId(req);
  const category = db
    .prepare("SELECT id, type FROM categories WHERE id = ? AND user_id = ?")
    .get(req.params.id, userId);
  if (!category) return sendError(res, 404, "NOT_FOUND");

  // At least one income category must remain, or income could no longer be
  // recorded.
  if (category.type === "income") {
    const { count } = db
      .prepare("SELECT COUNT(*) AS count FROM categories WHERE user_id = ? AND type = 'income'")
      .get(userId);
    if (count <= 1) return sendError(res, 400, "LAST_INCOME_CATEGORY");
  }

  db.prepare("DELETE FROM categories WHERE id = ? AND user_id = ?").run(category.id, userId);
  res.status(204).end();
});

// ---- Accounts
app.get("/api/accounts", (req, res) => {
  res.json(db.prepare(ACCOUNTS_WITH_BALANCE_SQL).all(getUserId(req)).map(toAccount));
});

app.post("/api/accounts", (req, res) => {
  const userId = getUserId(req);
  const { name, color, openingBalanceCents = 0 } = req.body;
  const nameError = validateName(name);
  if (nameError) return sendError(res, 400, nameError);
  if (color !== undefined && !isValidColor(color)) return sendError(res, 400, "INVALID_COLOR");
  if (!isValidCents(openingBalanceCents, { allowNegative: true }))
    return sendError(res, 400, "INVALID_OPENING_BALANCE");

  try {
    // Defensive: every user normally already has a default account from
    // registration; a user without accounts gets this one as default.
    const { count } = db
      .prepare("SELECT COUNT(*) AS count FROM accounts WHERE user_id = ?")
      .get(userId);
    const id = db
      .prepare(
        `INSERT INTO accounts (user_id, name, color, opening_balance_cents, is_default)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(userId, name.trim(), color ?? DEFAULT_COLOR, openingBalanceCents, count === 0 ? 1 : 0)
      .lastInsertRowid;
    const row = db.prepare("SELECT * FROM accounts WHERE id = ?").get(id);
    res.status(201).json({ ok: true, account: toAccount(row) });
  } catch (err) {
    if (isUniqueViolation(err)) return sendError(res, 400, "ACCOUNT_EXISTS");
    throw err;
  }
});

app.patch("/api/accounts/:id", (req, res) => {
  const userId = getUserId(req);
  const { name, color, openingBalanceCents, isDefault } = req.body;

  const existing = db
    .prepare("SELECT * FROM accounts WHERE id = ? AND user_id = ?")
    .get(req.params.id, userId);
  if (!existing) return sendError(res, 404, "NOT_FOUND");

  if (name !== undefined) {
    const nameError = validateName(name);
    if (nameError) return sendError(res, 400, nameError);
  }
  if (color !== undefined && !isValidColor(color)) return sendError(res, 400, "INVALID_COLOR");
  if (
    openingBalanceCents !== undefined &&
    !isValidCents(openingBalanceCents, { allowNegative: true })
  )
    return sendError(res, 400, "INVALID_OPENING_BALANCE");

  // isDefault only supports `true` ("make this the default"): there is always
  // exactly one default account, so it cannot be unset on its own.
  const makeDefault = isDefault === true;

  try {
    db.transaction(() => {
      if (makeDefault) db.prepare("UPDATE accounts SET is_default = 0 WHERE user_id = ?").run(userId);
      db.prepare(
        `UPDATE accounts SET name = ?, color = ?, opening_balance_cents = ?, is_default = ?
         WHERE id = ? AND user_id = ?`,
      ).run(
        name?.trim() ?? existing.name,
        color ?? existing.color,
        openingBalanceCents ?? existing.opening_balance_cents,
        makeDefault ? 1 : existing.is_default,
        existing.id,
        userId,
      );
    })();
  } catch (err) {
    if (isUniqueViolation(err)) return sendError(res, 400, "ACCOUNT_EXISTS");
    throw err;
  }
  const row = db
    .prepare(`SELECT * FROM (${ACCOUNTS_WITH_BALANCE_SQL}) WHERE id = ?`)
    .get(userId, existing.id);
  res.json({ ok: true, account: toAccount(row) });
});

app.delete("/api/accounts/:id", (req, res) => {
  const userId = getUserId(req);
  const account = db
    .prepare("SELECT id, is_default FROM accounts WHERE id = ? AND user_id = ?")
    .get(req.params.id, userId);
  if (!account) return sendError(res, 404, "NOT_FOUND");

  // The app always needs one account (the dashboard has no "no account" view).
  const { count: accountCount } = db
    .prepare("SELECT COUNT(*) AS count FROM accounts WHERE user_id = ?")
    .get(userId);
  if (accountCount <= 1) return sendError(res, 400, "LAST_ACCOUNT");

  // Without foreign keys, deleting an account with transactions would orphan
  // them: the deletion is refused instead.
  const { count: transactionCount } = db
    .prepare("SELECT COUNT(*) AS count FROM transactions WHERE account_id = ?")
    .get(account.id);
  if (transactionCount > 0) return sendError(res, 400, "ACCOUNT_HAS_TRANSACTIONS");

  db.transaction(() => {
    db.prepare("DELETE FROM accounts WHERE id = ? AND user_id = ?").run(account.id, userId);
    // The default flag moves to the oldest remaining account.
    if (account.is_default) {
      db.prepare(
        `UPDATE accounts SET is_default = 1
         WHERE id = (SELECT id FROM accounts WHERE user_id = ? ORDER BY id ASC LIMIT 1)`,
      ).run(userId);
    }
  })();
  res.status(204).end();
});

// ---- Transactions
// Optional year/month/accountId filters, applied in SQL rather than by
// downloading everything and filtering on the client.
app.get("/api/transactions", (req, res) => {
  const userId = getUserId(req);
  const { year, month, accountId } = req.query;

  const filter = accountFilter(accountId, userId, "t.account_id");
  if (!filter) return sendError(res, 400, "INVALID_ACCOUNT");
  let sql = `${TRANSACTIONS_SELECT} WHERE t.user_id = ? ${filter.sql}`;
  const params = [userId, ...filter.params];

  if (year !== undefined) {
    const y = parseYear(year);
    if (!y) return sendError(res, 400, "INVALID_YEAR");
    let m = null;
    if (month !== undefined) {
      m = parseMonth(month);
      if (!m) return sendError(res, 400, "INVALID_MONTH");
    }
    sql += " AND t.date >= ? AND t.date < ?";
    params.push(...periodRange(y, m));
  }

  sql += " ORDER BY t.date DESC, t.id DESC";
  res.json(db.prepare(sql).all(...params).map(toTransaction));
});

// Years that have transactions, newest first (period selectors).
app.get("/api/transactions/years", (req, res) => {
  const userId = getUserId(req);
  const filter = accountFilter(req.query.accountId, userId);
  if (!filter) return sendError(res, 400, "INVALID_ACCOUNT");
  const years = db
    .prepare(
      `SELECT DISTINCT CAST(substr(date, 1, 4) AS INTEGER) AS year FROM transactions
       WHERE user_id = ? ${filter.sql} ORDER BY year DESC`,
    )
    .all(userId, ...filter.params)
    .map((row) => row.year);
  res.json(years);
});

// Months (1-12) of a year that have transactions.
app.get("/api/transactions/months", (req, res) => {
  const userId = getUserId(req);
  const year = parseYear(req.query.year);
  if (!year) return sendError(res, 400, "INVALID_YEAR");
  const filter = accountFilter(req.query.accountId, userId);
  if (!filter) return sendError(res, 400, "INVALID_ACCOUNT");
  const months = db
    .prepare(
      `SELECT DISTINCT CAST(substr(date, 6, 2) AS INTEGER) AS month FROM transactions
       WHERE user_id = ? AND date >= ? AND date < ? ${filter.sql} ORDER BY month ASC`,
    )
    .all(userId, ...periodRange(year), ...filter.params)
    .map((row) => row.month);
  res.json(months);
});

app.post("/api/transactions", (req, res) => {
  const userId = getUserId(req);
  const fields = parseTransactionBody(req.body);
  if (fields.error) return sendError(res, 400, fields.error);

  // Without an explicit account, the user's default account is used.
  let accountId = req.body.accountId;
  if (accountId) {
    if (!accountBelongsToUser(accountId, userId)) return sendError(res, 400, "INVALID_ACCOUNT");
  } else {
    accountId = getDefaultAccountId(userId);
    if (!accountId) return sendError(res, 400, "NO_ACCOUNT");
  }

  const id = db
    .prepare(
      `INSERT INTO transactions
         (user_id, account_id, date, amount_cents, type, category_name, description)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      userId,
      accountId,
      fields.date,
      fields.amountCents,
      getCategoryType(userId, fields.categoryName),
      fields.categoryName,
      fields.description,
    ).lastInsertRowid;
  const row = db.prepare(`${TRANSACTIONS_SELECT} WHERE t.id = ?`).get(id);
  res.status(201).json({ ok: true, transaction: toTransaction(row) });
});

// Replaces a transaction. accountId is optional: when omitted the
// transaction stays on its current account.
app.put("/api/transactions/:id", (req, res) => {
  const userId = getUserId(req);
  const fields = parseTransactionBody(req.body);
  if (fields.error) return sendError(res, 400, fields.error);

  const { accountId } = req.body;
  if (accountId != null && accountId !== "" && !accountBelongsToUser(accountId, userId))
    return sendError(res, 400, "INVALID_ACCOUNT");
  if (isTransferRow(req.params.id, userId)) return sendError(res, 400, "IS_TRANSFER");

  const info = db
    .prepare(
      `UPDATE transactions SET date = ?, amount_cents = ?, type = ?, category_name = ?,
         description = ?, account_id = COALESCE(?, account_id)
       WHERE id = ? AND user_id = ?`,
    )
    .run(
      fields.date,
      fields.amountCents,
      getCategoryType(userId, fields.categoryName),
      fields.categoryName,
      fields.description,
      accountId || null,
      req.params.id,
      userId,
    );
  if (info.changes === 0) return sendError(res, 404, "NOT_FOUND");

  const row = db.prepare(`${TRANSACTIONS_SELECT} WHERE t.id = ?`).get(req.params.id);
  res.json({ ok: true, transaction: toTransaction(row) });
});

app.delete("/api/transactions/:id", (req, res) => {
  const userId = getUserId(req);
  if (isTransferRow(req.params.id, userId)) return sendError(res, 400, "IS_TRANSFER");
  const info = db
    .prepare("DELETE FROM transactions WHERE id = ? AND user_id = ?")
    .run(req.params.id, userId);
  if (info.changes === 0) return sendError(res, 404, "NOT_FOUND");
  res.status(204).end();
});

// ---- Transfers
// The two rows of a transfer are only ever written together, so they always
// share date, amount and description. :id is the transfer id.
function isTransferRow(transactionId, userId) {
  return !!db
    .prepare("SELECT 1 FROM transactions WHERE id = ? AND user_id = ? AND transfer_id IS NOT NULL")
    .get(transactionId, userId);
}

function getTransfer(transferId, userId) {
  const row = db
    .prepare(`${TRANSACTIONS_SELECT} WHERE t.transfer_id = ? AND t.user_id = ? AND t.type = 'transfer_out'`)
    .get(transferId, userId);
  return row ? toTransfer(row) : null;
}

// Shared by POST and PUT: { error } or the validated fields.
function readTransfer(req, userId) {
  const fields = parseTransferBody(req.body);
  if (fields.error) return fields;
  if (
    !accountBelongsToUser(fields.fromAccountId, userId) ||
    !accountBelongsToUser(fields.toAccountId, userId)
  )
    return { error: "INVALID_ACCOUNT" };
  return fields;
}

app.post("/api/transfers", (req, res) => {
  const userId = getUserId(req);
  const fields = readTransfer(req, userId);
  if (fields.error) return sendError(res, 400, fields.error);
  const transferId = insertTransfer(db, { userId, ...fields });
  res.status(201).json({ ok: true, transfer: getTransfer(transferId, userId) });
});

app.put("/api/transfers/:id", (req, res) => {
  const userId = getUserId(req);
  const fields = readTransfer(req, userId);
  if (fields.error) return sendError(res, 400, fields.error);
  if (!getTransfer(req.params.id, userId)) return sendError(res, 404, "NOT_FOUND");

  const update = db.prepare(
    `UPDATE transactions SET account_id = ?, date = ?, amount_cents = ?, description = ?
     WHERE transfer_id = ? AND user_id = ? AND type = ?`,
  );
  db.transaction(() => {
    for (const [accountId, type] of [
      [fields.fromAccountId, "transfer_out"],
      [fields.toAccountId, "transfer_in"],
    ]) {
      update.run(accountId, fields.date, fields.amountCents, fields.description, req.params.id, userId, type);
    }
  })();
  res.json({ ok: true, transfer: getTransfer(req.params.id, userId) });
});

app.delete("/api/transfers/:id", (req, res) => {
  const info = db
    .prepare("DELETE FROM transactions WHERE transfer_id = ? AND user_id = ?")
    .run(req.params.id, getUserId(req));
  if (info.changes === 0) return sendError(res, 404, "NOT_FOUND");
  res.status(204).end();
});

// ---- Dashboard: everything the home page needs in one round trip.
// It always shows one account (never an aggregate, unlike Analytics); without
// accountId the user's default account is used.
app.get("/api/dashboard", (req, res) => {
  const userId = getUserId(req);
  const year = parseYear(req.query.year);
  if (!year) return sendError(res, 400, "INVALID_YEAR");
  const month = parseMonth(req.query.month);
  if (!month) return sendError(res, 400, "INVALID_MONTH");

  let accountId = req.query.accountId;
  if (accountId) {
    if (!accountBelongsToUser(accountId, userId)) return sendError(res, 400, "INVALID_ACCOUNT");
  } else {
    accountId = getDefaultAccountId(userId);
    if (!accountId) return sendError(res, 400, "NO_ACCOUNT");
  }
  const [from, to] = periodRange(year, month);

  const accounts = db.prepare(ACCOUNTS_WITH_BALANCE_SQL).all(userId).map(toAccount);
  const activeAccount = accounts.find((a) => String(a.id) === String(accountId)) ?? null;

  const years = db
    .prepare(
      `SELECT DISTINCT CAST(substr(date, 1, 4) AS INTEGER) AS year FROM transactions
       WHERE user_id = ? AND account_id = ? ORDER BY year DESC`,
    )
    .all(userId, accountId)
    .map((row) => row.year);

  const categories = db
    .prepare("SELECT * FROM categories WHERE user_id = ? ORDER BY name ASC")
    .all(userId)
    .map(toCategory);

  const totals = db
    .prepare(
      `SELECT COUNT(*) AS count, ${TOTALS_SQL} FROM transactions
       WHERE user_id = ? AND account_id = ? AND date >= ? AND date < ?`,
    )
    .get(userId, accountId, from, to);

  const recent = db
    .prepare(
      `${TRANSACTIONS_SELECT}
       WHERE t.user_id = ? AND t.account_id = ? AND t.date >= ? AND t.date < ?
       ORDER BY t.date DESC, t.id DESC LIMIT 5`,
    )
    .all(userId, accountId, from, to)
    .map(toTransaction);

  const breakdown = db
    .prepare(
      `SELECT category_name, type, SUM(amount_cents) AS total_cents FROM transactions
       WHERE user_id = ? AND account_id = ? AND date >= ? AND date < ? ${NOT_TRANSFER_SQL}
       GROUP BY category_name, type ORDER BY category_name ASC`,
    )
    .all(userId, accountId, from, to)
    .map((row) => ({ categoryName: row.category_name, type: row.type, totalCents: row.total_cents }));

  res.json({
    years,
    categories,
    summary: {
      year,
      month,
      count: totals.count,
      incomeCents: totals.income_cents,
      expensesCents: totals.expenses_cents,
      netCents: totals.income_cents - totals.expenses_cents,
    },
    recent,
    breakdown,
    accounts,
    activeAccount,
  });
});

// ---- Analytics: a whole year in one round trip, across all accounts or
// filtered to one.
app.get("/api/analytics", (req, res) => {
  const userId = getUserId(req);
  const year = parseYear(req.query.year);
  if (!year) return sendError(res, 400, "INVALID_YEAR");
  const filter = accountFilter(req.query.accountId, userId);
  if (!filter) return sendError(res, 400, "INVALID_ACCOUNT");
  const params = [userId, ...periodRange(year), ...filter.params];
  const where = `WHERE user_id = ? AND date >= ? AND date < ? ${filter.sql}`;

  const monthly = db
    .prepare(
      `SELECT CAST(substr(date, 6, 2) AS INTEGER) AS month, ${TOTALS_SQL}
       FROM transactions ${where} GROUP BY month ORDER BY month ASC`,
    )
    .all(...params)
    .map((row) => ({
      month: row.month,
      incomeCents: row.income_cents,
      expensesCents: row.expenses_cents,
      netCents: row.income_cents - row.expenses_cents,
    }));

  const categoryTotals = db
    .prepare(
      `SELECT category_name, type, SUM(amount_cents) AS total_cents
       FROM transactions ${where} ${NOT_TRANSFER_SQL}
       GROUP BY category_name, type ORDER BY category_name ASC`,
    )
    .all(...params)
    .map((row) => ({ categoryName: row.category_name, type: row.type, totalCents: row.total_cents }));

  // { [month]: { [categoryName]: totalCents } }
  const monthlyByCategory = {};
  const rows = db
    .prepare(
      `SELECT CAST(substr(date, 6, 2) AS INTEGER) AS month, category_name,
         SUM(amount_cents) AS total_cents
       FROM transactions ${where} ${NOT_TRANSFER_SQL} GROUP BY month, category_name`,
    )
    .all(...params);
  for (const row of rows) {
    monthlyByCategory[row.month] ??= {};
    monthlyByCategory[row.month][row.category_name] = row.total_cents;
  }

  res.json({ monthly, categoryTotals, monthlyByCategory });
});

// ---- Export
// The CSV follows the conventions of spreadsheet apps in each language:
// Italian Excel expects ";" and a decimal comma, English "," and a dot.
const CSV_FORMATS = {
  en: {
    separator: ",",
    decimal: ".",
    header: ["Date", "Amount", "Type", "Category", "Description", "Account", "Transfer account"],
    types: {
      income: "income",
      expense: "expense",
      transfer_in: "transfer in",
      transfer_out: "transfer out",
    },
  },
  it: {
    separator: ";",
    decimal: ",",
    header: ["Data", "Importo", "Tipo", "Categoria", "Descrizione", "Conto", "Conto collegato"],
    types: {
      income: "entrata",
      expense: "uscita",
      transfer_in: "giroconto in entrata",
      transfer_out: "giroconto in uscita",
    },
  },
};

// Quotes a cell when it contains the separator, quotes or newlines. Values
// starting with = + - @ are prefixed with ' so spreadsheet apps do not run
// them as formulas (CSV injection): categories and descriptions are free
// text.
function csvCell(value, separator) {
  let text = String(value ?? "");
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  const needsQuotes = text.includes(separator) || /["\n\r]/.test(text);
  return needsQuotes ? `"${text.replace(/"/g, '""')}"` : text;
}

app.get("/api/export/transactions.csv", (req, res) => {
  const format = CSV_FORMATS[normalizeLocale(req.query.locale)];
  const rows = db
    .prepare(
      `SELECT t.*, a.name AS account_name, ca.name AS counterpart_account_name
       FROM transactions t
       LEFT JOIN accounts a ON a.id = t.account_id
       LEFT JOIN transactions c ON c.transfer_id = t.transfer_id AND c.id <> t.id
       LEFT JOIN accounts ca ON ca.id = c.account_id
       WHERE t.user_id = ? ORDER BY t.date DESC, t.id DESC`,
    )
    .all(getUserId(req));

  const lines = rows.map((row) =>
    [
      row.date,
      (row.amount_cents / 100).toFixed(2).replace(".", format.decimal),
      format.types[row.type],
      csvCell(row.category_name, format.separator),
      csvCell(row.description, format.separator),
      csvCell(row.account_name, format.separator),
      csvCell(row.counterpart_account_name, format.separator),
    ].join(format.separator),
  );

  res.type("text/csv; charset=utf-8");
  res.attachment("transactions.csv");
  res.send([format.header.join(format.separator), ...lines].join("\n"));
});

// The database holds ALL users (including password hashes), unlike the CSV
// export: only the instance owner may download it. serialize() returns a
// consistent in-memory snapshot instead of reading a file that may be
// written to concurrently.
app.get("/api/export/database", (req, res) => {
  if (!isOwner(getUserId(req))) return sendError(res, 403, "FORBIDDEN");
  res.attachment("konto.db");
  res.type("application/vnd.sqlite3");
  res.send(db.serialize());
});

// Unknown API route: JSON 404 instead of falling through to the SPA.
app.use("/api", (req, res) => sendError(res, 404, "NOT_FOUND"));

// ============================================================================
// SPA CATCH-ALL
// ============================================================================
app.get(/.*/, (req, res) => {
  res.sendFile(path.join(frontendDistPath, "index.html"));
});

// ============================================================================
// ERROR HANDLER
// ============================================================================
// Without it, Express answers with a full stack trace whenever NODE_ENV is
// not "production" (while this app treats anything but "development" as
// production). Errors are logged server-side; clients get a generic body.
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  if (err.type === "entity.parse.failed") return sendError(res, 400, "INVALID_JSON");
  if (err.type === "entity.too.large") return sendError(res, 413, "PAYLOAD_TOO_LARGE");
  console.error(err);
  sendError(res, 500, "INTERNAL_ERROR");
});

// ============================================================================
// START (HTTP in development, HTTPS in production when certificates exist)
// ============================================================================
// Only when run directly (node server.js / PM2): tests import `app` without
// opening a port.
if (require.main === module) {
  const hasCerts = fs.existsSync(certPath) && fs.existsSync(keyPath);
  const useHttps = !isDev && hasCerts;
  const server = useHttps
    ? https.createServer({ cert: fs.readFileSync(certPath), key: fs.readFileSync(keyPath) }, app)
    : http.createServer(app);

  if (useHttps) console.log("🔒 SSL certificates found: starting in HTTPS.");
  else if (isDev) console.log("⚙️ Development mode: starting in HTTP.");
  else console.log("⚠️ SSL certificates not found: starting in HTTP.");

  server.listen(PORT, HOST, () => {
    console.log(`🚀 Konto listening on ${useHttps ? "https" : "http"}://${HOST || "localhost"}:${PORT}`);
  });

  // Graceful shutdown (docker stop, pm2 restart, Ctrl+C): stop accepting
  // connections, let running requests finish, then close the database so no
  // write is cut in half. Forced exit if it takes too long.
  const shutdown = (signal) => {
    console.log(`${signal} received: shutting down...`);
    server.close(() => {
      db.close();
      sessionStore.close();
      process.exit(0);
    });
    server.closeIdleConnections?.();
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.once("SIGTERM", shutdown);
  process.once("SIGINT", shutdown);
}

module.exports = { app, db };
