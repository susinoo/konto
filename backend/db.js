// Database location, schema creation and migrations.
//
// Schema versions are tracked with SQLite's `PRAGMA user_version`:
//   0/1  legacy Italian schema (spese, categorie, conti; DD/MM/YY dates,
//        REAL amounts). Version 0 databases are first brought to the final
//        legacy shape (v1) by the historical idempotent checks below.
//   2    English schema (transactions, categories, accounts; ISO dates,
//        integer cents).
//   3    current schema: transfers between accounts (transfer_in /
//        transfer_out transaction pairs linked by transfer_id).
//
// New databases are created as v2 and then go through the same migrations
// as existing ones. To change the schema, add a new `migrateV3ToV4` step and
// bump SCHEMA_VERSION; never edit a migration that has already shipped.

const fs = require("fs");
const path = require("path");
const Database = require("better-sqlite3");

const SCHEMA_VERSION = 3;

const DB_FILENAME = "konto.db";
const SESSIONS_DB_FILENAME = "sessions.db";
const LEGACY_DATA_DIRNAME = "dati";
const LEGACY_DB_FILENAME = "spese.db";
const DEFAULT_COLOR = "#6B7280";

// Default data for new users, in the language they registered with. Names
// are user data: once created they are never translated again.
const SUPPORTED_LOCALES = ["en", "it"];
const DEFAULT_LOCALE = "en";

const DEFAULT_CATEGORY_COLORS = [
  { key: "income", color: "#10B981", type: "income" },
  { key: "subscriptions", color: "#6366F1", type: "expense" },
  { key: "bar", color: "#F59E0B", type: "expense" },
  { key: "health", color: "#EF4444", type: "expense" },
  { key: "restaurants", color: "#F97316", type: "expense" },
  { key: "gifts", color: "#EC4899", type: "expense" },
  { key: "shopping", color: "#8B5CF6", type: "expense" },
  { key: "leisure", color: "#3B82F6", type: "expense" },
  { key: "car", color: "#14B8A6", type: "expense" },
];

const DEFAULT_NAMES = {
  en: {
    account: "Main account",
    categories: {
      income: "Income",
      subscriptions: "Subscriptions",
      bar: "Cafés & bars",
      health: "Healthcare",
      restaurants: "Restaurants",
      gifts: "Gifts",
      shopping: "Shopping",
      leisure: "Leisure",
      car: "Car",
    },
  },
  it: {
    account: "Conto principale",
    categories: {
      income: "Entrata",
      subscriptions: "Abbonamento",
      bar: "Bar",
      health: "Cure mediche",
      restaurants: "Ristorante",
      gifts: "Regalo",
      shopping: "Shopping",
      leisure: "Svago",
      car: "Auto",
    },
  },
};

function normalizeLocale(locale) {
  return SUPPORTED_LOCALES.includes(locale) ? locale : DEFAULT_LOCALE;
}

function defaultCategories(locale) {
  const names = DEFAULT_NAMES[normalizeLocale(locale)].categories;
  return DEFAULT_CATEGORY_COLORS.map(({ key, color, type }) => ({ name: names[key], color, type }));
}

function defaultAccountName(locale) {
  return DEFAULT_NAMES[normalizeLocale(locale)].account;
}

// ============================================================================
// DATA DIRECTORY
// ============================================================================

// Renames a file together with its rollback journal, if a crash left one
// behind: SQLite needs both to recover the database.
function renameDatabaseFile(from, to) {
  fs.renameSync(from, to);
  if (fs.existsSync(`${from}-journal`)) fs.renameSync(`${from}-journal`, `${to}-journal`);
}

// Resolves where the databases live and moves legacy installations to the
// current layout: backend/dati/spese.db → backend/data/konto.db.
//
// KONTO_DATA_DIR (`dataDir` option) overrides the default directory; in that
// case only the file rename applies.
function prepareDataDir({ dataDir, backendDir = __dirname, log = console.log } = {}) {
  let dir = dataDir;
  if (!dir) {
    dir = path.join(backendDir, "data");
    const legacyDir = path.join(backendDir, LEGACY_DATA_DIRNAME);
    if (!fs.existsSync(dir) && fs.existsSync(legacyDir)) {
      fs.renameSync(legacyDir, dir);
      log(`Data directory moved: ${legacyDir} → ${dir}`);
    }
  }
  fs.mkdirSync(dir, { recursive: true });

  const dbPath = path.join(dir, DB_FILENAME);
  const legacyDbPath = path.join(dir, LEGACY_DB_FILENAME);
  if (!fs.existsSync(dbPath) && fs.existsSync(legacyDbPath)) {
    renameDatabaseFile(legacyDbPath, dbPath);
    log(`Database renamed: ${legacyDbPath} → ${dbPath}`);
  }

  return {
    dataDir: dir,
    dbPath,
    sessionsDbPath: path.join(dir, SESSIONS_DB_FILENAME),
  };
}

// For maintenance scripts: opens the existing database without moving or
// migrating anything. Exits with a hint if the database is missing or still
// on a legacy schema (the server migrates it on its next start).
function openExistingDatabase({ dataDir, backendDir = __dirname } = {}) {
  const dbPath = path.join(dataDir || path.join(backendDir, "data"), DB_FILENAME);
  if (!fs.existsSync(dbPath)) {
    console.error(`No database found at ${dbPath}. Start the server once to create or migrate it.`);
    process.exit(1);
  }
  const db = new Database(dbPath);
  if (getUserVersion(db) !== SCHEMA_VERSION) {
    console.error(
      `The database is on schema v${getUserVersion(db)}, expected v${SCHEMA_VERSION}. Start the server once to migrate it.`,
    );
    process.exit(1);
  }
  return db;
}

// ============================================================================
// HELPERS
// ============================================================================

function tableExists(db, tableName) {
  return !!db
    .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(tableName);
}

function columnExists(db, tableName, columnName) {
  return db
    .prepare(`PRAGMA table_info(${tableName})`)
    .all()
    .some((column) => column.name === columnName);
}

function getUserVersion(db) {
  return db.pragma("user_version", { simple: true });
}

function setUserVersion(db, version) {
  db.pragma(`user_version = ${Number(version)}`);
}

function timestamp() {
  return new Date().toISOString().replace(/[-:]/g, "").replace(/\..+/, "").replace("T", "-");
}

// ============================================================================
// SCHEMA v2
// ============================================================================

const USERS_TABLE_SQL = `
  CREATE TABLE users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    is_owner INTEGER NOT NULL DEFAULT 0,
    session_version INTEGER NOT NULL DEFAULT 0
  )
`;

const V2_TABLES_SQL = `
  CREATE TABLE accounts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    color TEXT NOT NULL DEFAULT '${DEFAULT_COLOR}',
    opening_balance_cents INTEGER NOT NULL DEFAULT 0,
    is_default INTEGER NOT NULL DEFAULT 0,
    UNIQUE (user_id, name)
  );

  CREATE TABLE categories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    color TEXT NOT NULL DEFAULT '${DEFAULT_COLOR}',
    type TEXT NOT NULL DEFAULT 'expense' CHECK (type IN ('income', 'expense')),
    UNIQUE (user_id, name)
  );

  -- category_name is a snapshot of the category name, not a reference:
  -- renaming or deleting a category never rewrites past transactions.
  CREATE TABLE transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    account_id INTEGER NOT NULL,
    date TEXT NOT NULL CHECK (date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
    amount_cents INTEGER NOT NULL CHECK (amount_cents >= 0),
    type TEXT NOT NULL CHECK (type IN ('income', 'expense')),
    category_name TEXT NOT NULL,
    description TEXT
  );
`;

const V2_INDEXES_SQL = `
  CREATE INDEX idx_transactions_user_date ON transactions (user_id, date);
  CREATE INDEX idx_transactions_account_date ON transactions (account_id, date);
  CREATE INDEX idx_categories_user ON categories (user_id);
  CREATE INDEX idx_accounts_user ON accounts (user_id);
`;

function createSchemaV2(db) {
  db.transaction(() => {
    db.exec(USERS_TABLE_SQL);
    db.exec(V2_TABLES_SQL);
    db.exec(V2_INDEXES_SQL);
    setUserVersion(db, 2);
  })();
}

// ============================================================================
// LEGACY SCHEMA → v1
// ============================================================================

// Historical, idempotent startup checks that every pre-v2 installation went
// through. They bring any legacy database to the final legacy shape (v1),
// which migrateV1ToV2 then converts. Kept verbatim in behavior.
function migrateLegacyToV1(db, { seedUsername, getSeedPasswordHash, log }) {
  if (!tableExists(db, "categorie")) {
    db.exec(`
      CREATE TABLE categorie (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        nome TEXT NOT NULL,
        colore TEXT NOT NULL DEFAULT '${DEFAULT_COLOR}',
        UNIQUE(user_id, nome)
      )
    `);
  }
  if (!tableExists(db, "spese")) {
    db.exec(`
      CREATE TABLE spese (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        date TEXT NOT NULL,
        amount REAL NOT NULL,
        category TEXT NOT NULL,
        activity TEXT
      )
    `);
  }
  if (!tableExists(db, "users")) {
    db.exec(`
      CREATE TABLE users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `);
  }
  if (!columnExists(db, "spese", "user_id")) {
    db.exec("ALTER TABLE spese ADD COLUMN user_id INTEGER");
  }

  // Single-user era: data had no owner. The seed user (or the oldest user)
  // inherits orphaned rows.
  let adminUserId = null;
  const { count: usersCount } = db.prepare("SELECT count(*) AS count FROM users").get();
  if (usersCount === 0) {
    log("Legacy database without users: creating the seed user...");
    adminUserId = db
      .prepare("INSERT INTO users (username, password_hash) VALUES (?, ?)")
      .run(seedUsername, getSeedPasswordHash()).lastInsertRowid;
  } else {
    adminUserId =
      db.prepare("SELECT id FROM users WHERE username = ?").get(seedUsername)?.id ??
      db.prepare("SELECT id FROM users ORDER BY id ASC LIMIT 1").get()?.id ??
      null;
  }

  if (!columnExists(db, "users", "is_owner")) {
    db.exec("ALTER TABLE users ADD COLUMN is_owner INTEGER NOT NULL DEFAULT 0");
    if (adminUserId) db.prepare("UPDATE users SET is_owner = 1 WHERE id = ?").run(adminUserId);
  }

  // Categories used to be global: move them to per-user rows.
  if (!columnExists(db, "categorie", "user_id")) {
    db.exec(`
      CREATE TABLE categorie_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        nome TEXT NOT NULL,
        colore TEXT NOT NULL DEFAULT '${DEFAULT_COLOR}',
        UNIQUE(user_id, nome)
      )
    `);
    if (adminUserId) {
      db.prepare(
        "INSERT INTO categorie_new (user_id, nome, colore) SELECT ?, nome, colore FROM categorie",
      ).run(adminUserId);
    }
    db.exec("DROP TABLE categorie");
    db.exec("ALTER TABLE categorie_new RENAME TO categorie");
  }

  if (adminUserId) {
    db.prepare("UPDATE spese SET user_id = ? WHERE user_id IS NULL").run(adminUserId);
  }

  if (!tableExists(db, "conti")) {
    db.exec(`
      CREATE TABLE conti (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        nome TEXT NOT NULL,
        colore TEXT NOT NULL DEFAULT '${DEFAULT_COLOR}',
        saldo_iniziale REAL NOT NULL DEFAULT 0,
        is_default INTEGER NOT NULL DEFAULT 0,
        UNIQUE(user_id, nome)
      )
    `);
  }
  if (!columnExists(db, "spese", "conto_id")) {
    db.exec("ALTER TABLE spese ADD COLUMN conto_id INTEGER");
  }
  if (!columnExists(db, "conti", "is_default")) {
    db.exec("ALTER TABLE conti ADD COLUMN is_default INTEGER NOT NULL DEFAULT 0");
  }

  // Every user gets at least one account, which adopts their unassigned
  // transactions.
  const usersWithoutAccount = db
    .prepare(
      "SELECT u.id FROM users u WHERE NOT EXISTS (SELECT 1 FROM conti c WHERE c.user_id = u.id)",
    )
    .all();
  for (const { id: userId } of usersWithoutAccount) {
    const accountId = db
      .prepare(
        `INSERT INTO conti (user_id, nome, colore, saldo_iniziale, is_default)
         VALUES (?, ?, '${DEFAULT_COLOR}', 0, 1)`,
      )
      .run(userId, defaultAccountName("it")).lastInsertRowid;
    db.prepare("UPDATE spese SET conto_id = ? WHERE user_id = ? AND conto_id IS NULL").run(
      accountId,
      userId,
    );
  }

  // Exactly one default account per user: the oldest one, if none is set.
  db.exec(`
    UPDATE conti SET is_default = 1
    WHERE id IN (
      SELECT MIN(c.id) FROM conti c
      WHERE NOT EXISTS (SELECT 1 FROM conti d WHERE d.user_id = c.user_id AND d.is_default = 1)
      GROUP BY c.user_id
    )
  `);

  // Income/expense type, frozen on each transaction. Before this column only
  // the category named "Entrata" counted as income.
  if (!columnExists(db, "categorie", "tipo")) {
    db.exec("ALTER TABLE categorie ADD COLUMN tipo TEXT NOT NULL DEFAULT 'uscita'");
    db.prepare("UPDATE categorie SET tipo = 'entrata' WHERE nome = 'Entrata'").run();
  }
  if (!columnExists(db, "spese", "tipo")) {
    db.exec("ALTER TABLE spese ADD COLUMN tipo TEXT NOT NULL DEFAULT 'uscita'");
    db.prepare("UPDATE spese SET tipo = 'entrata' WHERE category = 'Entrata'").run();
  }

  if (!columnExists(db, "users", "session_version")) {
    db.exec("ALTER TABLE users ADD COLUMN session_version INTEGER NOT NULL DEFAULT 0");
  }

  // The seed user always had default categories.
  if (adminUserId) {
    const { count } = db
      .prepare("SELECT count(*) AS count FROM categorie WHERE user_id = ?")
      .get(adminUserId);
    if (count === 0) {
      const insert = db.prepare(
        "INSERT INTO categorie (user_id, nome, colore, tipo) VALUES (?, ?, ?, ?)",
      );
      // Legacy installations predate i18n and were Italian-only.
      for (const c of defaultCategories("it"))
        insert.run(adminUserId, c.name, c.color, c.type === "income" ? "entrata" : "uscita");
    }
  }

  setUserVersion(db, 1);
}

// ============================================================================
// v1 → v2
// ============================================================================

// Rows that cannot be converted safely abort the migration (the database is
// left untouched) instead of being silently altered.
function assertV1DataConvertible(db) {
  const problems = [
    [
      "transactions with a date not in DD/MM/YY format",
      "SELECT count(*) AS n FROM spese WHERE date NOT GLOB '[0-3][0-9]/[01][0-9]/[0-9][0-9]'",
    ],
    ["transactions with a negative amount", "SELECT count(*) AS n FROM spese WHERE amount < 0"],
    [
      "transactions without an owner",
      "SELECT count(*) AS n FROM spese WHERE user_id IS NULL",
    ],
  ]
    .map(([label, sql]) => [label, db.prepare(sql).get().n])
    .filter(([, n]) => n > 0);

  if (problems.length) {
    throw new Error(
      `Migration to schema v2 aborted, the database was not modified. Found: ${problems
        .map(([label, n]) => `${n} ${label}`)
        .join("; ")}. Fix these rows and restart.`,
    );
  }
}

function migrateV1ToV2(db, { dataDir, log }) {
  assertV1DataConvertible(db);

  // Consistent snapshot of the v1 database before touching anything.
  const backupDir = path.join(dataDir, "backups");
  fs.mkdirSync(backupDir, { recursive: true });
  const backupPath = path.join(backupDir, `konto-v1-before-v2-${timestamp()}.db`);
  db.prepare("VACUUM INTO ?").run(backupPath);
  log(`Backup of the v1 database: ${backupPath}`);

  db.transaction(() => {
    db.exec(V2_TABLES_SQL);

    db.exec(`
      INSERT INTO accounts (id, user_id, name, color, opening_balance_cents, is_default)
      SELECT id, user_id, nome, colore, CAST(ROUND(saldo_iniziale * 100) AS INTEGER), is_default
      FROM conti;

      INSERT INTO categories (id, user_id, name, color, type)
      SELECT id, user_id, nome, colore, CASE tipo WHEN 'entrata' THEN 'income' ELSE 'expense' END
      FROM categorie;

      INSERT INTO transactions
        (id, user_id, account_id, date, amount_cents, type, category_name, description)
      SELECT
        s.id,
        s.user_id,
        COALESCE(s.conto_id, (
          SELECT c.id FROM conti c WHERE c.user_id = s.user_id
          ORDER BY c.is_default DESC, c.id ASC LIMIT 1
        )),
        '20' || substr(s.date, 7, 2) || '-' || substr(s.date, 4, 2) || '-' || substr(s.date, 1, 2),
        CAST(ROUND(s.amount * 100) AS INTEGER),
        CASE s.tipo WHEN 'entrata' THEN 'income' ELSE 'expense' END,
        s.category,
        NULLIF(TRIM(s.activity), '')
      FROM spese s;
    `);

    // Keep AUTOINCREMENT counters, so ids of deleted rows are never reused.
    for (const [from, to] of [
      ["conti", "accounts"],
      ["categorie", "categories"],
      ["spese", "transactions"],
    ]) {
      const old = db.prepare("SELECT seq FROM sqlite_sequence WHERE name = ?").get(from);
      if (!old) continue;
      db.prepare("DELETE FROM sqlite_sequence WHERE name = ?").run(to);
      db.prepare("INSERT INTO sqlite_sequence (name, seq) VALUES (?, ?)").run(to, old.seq);
    }

    db.exec(`
      DROP TABLE spese;
      DROP TABLE categorie;
      DROP TABLE conti;
    `);
    db.exec(V2_INDEXES_SQL);
    setUserVersion(db, 2);
  })();

  log("Database migrated to schema v2.");
}

// ============================================================================
// v2 → v3
// ============================================================================

// A transfer is a pair of rows, one per account: transfer_out on the source
// account and transfer_in on the target one, with the same date, amount and
// description and the same transfer_id (the id of the transfer_out row).
// Transfers have no category and never count as income or expenses; they
// only move the account balances.
const V3_TRANSACTIONS_TABLE_SQL = `
  CREATE TABLE transactions_v3 (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    account_id INTEGER NOT NULL,
    date TEXT NOT NULL CHECK (date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
    amount_cents INTEGER NOT NULL CHECK (amount_cents >= 0),
    type TEXT NOT NULL CHECK (type IN ('income', 'expense', 'transfer_in', 'transfer_out')),
    category_name TEXT,
    description TEXT,
    transfer_id INTEGER,
    CHECK ((type IN ('transfer_in', 'transfer_out')) = (transfer_id IS NOT NULL)),
    CHECK ((transfer_id IS NULL) = (category_name IS NOT NULL))
  )
`;

const V3_TRANSACTION_INDEXES_SQL = `
  CREATE INDEX idx_transactions_user_date ON transactions (user_id, date);
  CREATE INDEX idx_transactions_account_date ON transactions (account_id, date);
  CREATE INDEX idx_transactions_transfer ON transactions (transfer_id);
`;

// SQLite cannot change a CHECK constraint in place: the transactions table
// is rebuilt. Existing rows stay ordinary income/expense transactions (old
// "transfer" categories are not guessed into pairs).
function migrateV2ToV3(db, { dataDir, log, backup }) {
  if (backup) {
    const backupDir = path.join(dataDir, "backups");
    fs.mkdirSync(backupDir, { recursive: true });
    const backupPath = path.join(backupDir, `konto-v2-before-v3-${timestamp()}.db`);
    db.prepare("VACUUM INTO ?").run(backupPath);
    log(`Backup of the v2 database: ${backupPath}`);
  }

  db.transaction(() => {
    const seq = db.prepare("SELECT seq FROM sqlite_sequence WHERE name = 'transactions'").get()?.seq;

    db.exec(V3_TRANSACTIONS_TABLE_SQL);
    db.exec(`
      INSERT INTO transactions_v3
        (id, user_id, account_id, date, amount_cents, type, category_name, description)
      SELECT id, user_id, account_id, date, amount_cents, type, category_name, description
      FROM transactions;
      DROP TABLE transactions;
      ALTER TABLE transactions_v3 RENAME TO transactions;
    `);
    db.exec(V3_TRANSACTION_INDEXES_SQL);

    // Keep the AUTOINCREMENT counter, so ids of deleted rows are never reused.
    if (seq !== undefined) {
      db.prepare("DELETE FROM sqlite_sequence WHERE name IN ('transactions', 'transactions_v3')").run();
      db.prepare("INSERT INTO sqlite_sequence (name, seq) VALUES ('transactions', ?)").run(seq);
    }
    setUserVersion(db, 3);
  })();

  log("Database migrated to schema v3.");
}

// ============================================================================
// TRANSFERS
// ============================================================================

// Writes both rows of a transfer. The transfer_out row is inserted first and
// its own id becomes the transfer_id of the pair (0 is a placeholder that
// only exists inside this transaction). Returns the transfer_id.
function insertTransfer(db, { userId, fromAccountId, toAccountId, date, amountCents, description }) {
  return db.transaction(() => {
    const insert = db.prepare(
      `INSERT INTO transactions
         (user_id, account_id, date, amount_cents, type, category_name, description, transfer_id)
       VALUES (?, ?, ?, ?, ?, NULL, ?, ?)`,
    );
    const transferId = insert.run(
      userId, fromAccountId, date, amountCents, "transfer_out", description, 0,
    ).lastInsertRowid;
    db.prepare("UPDATE transactions SET transfer_id = ? WHERE id = ?").run(transferId, transferId);
    insert.run(userId, toAccountId, date, amountCents, "transfer_in", description, transferId);
    return transferId;
  })();
}

// ============================================================================
// SEED
// ============================================================================

function seedDefaultCategories(db, userId, locale) {
  const insert = db.prepare(
    "INSERT INTO categories (user_id, name, color, type) VALUES (?, ?, ?, ?)",
  );
  for (const c of defaultCategories(locale)) insert.run(userId, c.name, c.color, c.type);
}

// Every user needs an account from the start (the dashboard has no
// "no account" state). The registration wizard renames this one.
function seedDefaultAccount(db, userId, locale) {
  db.prepare(
    `INSERT INTO accounts (user_id, name, color, opening_balance_cents, is_default)
     VALUES (?, ?, '${DEFAULT_COLOR}', 0, 1)`,
  ).run(userId, defaultAccountName(locale));
}

// First start: the users table is empty, so the seed user from .env is
// created as the instance owner, with default categories and an account.
function seedOwnerIfEmpty(db, { seedUsername, getSeedPasswordHash, seedLocale, log }) {
  const { count } = db.prepare("SELECT count(*) AS count FROM users").get();
  if (count > 0) return;
  log(`Empty database: creating the owner user "${seedUsername}" from .env...`);
  db.transaction(() => {
    const userId = db
      .prepare("INSERT INTO users (username, password_hash, is_owner) VALUES (?, ?, 1)")
      .run(seedUsername, getSeedPasswordHash()).lastInsertRowid;
    seedDefaultCategories(db, userId, seedLocale);
    seedDefaultAccount(db, userId, seedLocale);
  })();
}

// ============================================================================
// ENTRY POINT
// ============================================================================

// Opens (creating it if needed) and migrates the main database.
// `getSeedPasswordHash` is only called when a seed user must be created;
// `seedLocale` is the language of the seed user's default data.
function openDatabase({
  dbPath,
  dataDir,
  seedUsername,
  getSeedPasswordHash,
  seedLocale = DEFAULT_LOCALE,
  log = console.log,
}) {
  const db = new Database(dbPath);
  const options = { dataDir, seedUsername, getSeedPasswordHash, seedLocale, log };

  const isEmpty = !db
    .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
    .get();
  const version = getUserVersion(db);

  if (isEmpty) {
    createSchemaV2(db);
  } else if (version > SCHEMA_VERSION) {
    throw new Error(
      `Database schema v${version} is newer than this version of Konto (v${SCHEMA_VERSION}).`,
    );
  } else if (version < 2) {
    if (version < 1) migrateLegacyToV1(db, options);
    migrateV1ToV2(db, options);
  }
  // Backed up only when the database was already v2 on disk: a fresh
  // database has nothing to save, and a legacy one already has its v1 backup.
  if (getUserVersion(db) < 3) migrateV2ToV3(db, { ...options, backup: !isEmpty && version === 2 });

  seedOwnerIfEmpty(db, options);
  return db;
}

module.exports = {
  SCHEMA_VERSION,
  DEFAULT_COLOR,
  prepareDataDir,
  openExistingDatabase,
  openDatabase,
  SUPPORTED_LOCALES,
  normalizeLocale,
  seedDefaultCategories,
  seedDefaultAccount,
  insertTransfer,
};
