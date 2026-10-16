// Builds a demo database with fictional users and data, for local testing,
// screenshots and trying the app. Never use it on real data: it refuses to
// write to backend/data (or the legacy backend/dati), and to any database
// that holds users other than the demo ones.
//
// The data is deterministic (seeded random generator): running the script
// again on the same day produces the same database. Transactions go from
// January 2025 up to today, so the current month always has data.
//
// Usage:
//   npm run seed:demo                     # → backend/demo-data/
//   node scripts/seed-demo.js <data-dir>  # → another directory
//   npm run dev:demo                      # start the server on the demo data
//
// Demo logins (fictional data only):
//   john.doe / demo-password   (instance owner)
//   jane.doe / demo-password

const fs = require("fs");
const path = require("path");
const bcrypt = require("bcryptjs");
const { openDatabase, seedDefaultCategories, seedDefaultAccount, insertTransfer } = require("../db");

const DEMO_PASSWORD = "demo-password";
const DEMO_USERNAMES = ["john.doe", "jane.doe"];
const START_DATE = "2025-01-01";
const DEFAULT_DATA_DIR = path.join(__dirname, "..", "demo-data");
const PROTECTED_DIRS = ["data", "dati"].map((dir) => path.join(__dirname, "..", dir));

// ---- Deterministic random numbers (mulberry32)
function createRandom(seed) {
  let state = seed >>> 0;
  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int: (min, max) => min + Math.floor(next() * (max - min + 1)),
    cents: (min, max) => Math.round((min + next() * (max - min)) * 100),
    pick: (items) => items[Math.floor(next() * items.length)],
    chance: (probability) => next() < probability,
  };
}

// ---- Dates
const pad = (n) => String(n).padStart(2, "0");
const isoDate = (year, month, day) => `${year}-${pad(month)}-${pad(day)}`;
const daysInMonth = (year, month) => new Date(year, month, 0).getDate();

function todayIso() {
  const now = new Date();
  return isoDate(now.getFullYear(), now.getMonth() + 1, now.getDate());
}

// Calls fn(year, month) for every month from START_DATE to endDate.
function forEachMonth(endDate, fn) {
  let [year, month] = START_DATE.split("-").map(Number);
  const [endYear, endMonth] = endDate.split("-").map(Number);
  while (year < endYear || (year === endYear && month <= endMonth)) {
    fn(year, month);
    month += 1;
    if (month > 12) [year, month] = [year + 1, 1];
  }
}

// ---- Demo profiles
// Categories the demo users add on top of the default (English) ones.
const EXTRA_CATEGORIES = {
  "john.doe": [
    { name: "Salary", color: "#059669", type: "income" },
    { name: "Interest", color: "#0D9488", type: "income" },
    { name: "Rent", color: "#7C3AED", type: "expense" },
    { name: "Groceries", color: "#84CC16", type: "expense" },
    { name: "Travel", color: "#0EA5E9", type: "expense" },
  ],
  "jane.doe": [
    { name: "Client work", color: "#059669", type: "income" },
    { name: "Rent", color: "#7C3AED", type: "expense" },
    { name: "Groceries", color: "#84CC16", type: "expense" },
    { name: "Software", color: "#6366F1", type: "expense" },
    { name: "Coworking", color: "#A855F7", type: "expense" },
    { name: "Taxes", color: "#DC2626", type: "expense" },
  ],
};

const DESCRIPTIONS = {
  groceries: ["Supermarket", "Farmers market", "Bakery", "Organic shop", "Weekly groceries"],
  cafes: ["Coffee", "Cappuccino and croissant", "Iced tea", "Coffee with Sam", "Espresso"],
  restaurants: ["Pizza night", "Sushi", "Dinner with friends", "Lunch out", "Thai takeaway", "Burger"],
  leisure: ["Cinema", "Concert tickets", "Bookshop", "Museum", "Bowling", "Board game"],
  shopping: ["Sneakers", "T-shirt", "Headphones", "Kitchen stuff", "Jacket", "Backpack"],
  health: ["Pharmacy", "Dentist", "Eye exam", "Physiotherapy", "Vitamins"],
  gifts: ["Birthday present", "Wedding gift", "Flowers", "Christmas present"],
  car: ["Fuel", "Car wash", "Parking", "Tyres check"],
  equipment: ["New monitor", "Keyboard", "Drawing tablet", "Desk lamp"],
};

// Generates all transactions of one profile as
// { account, date, amountCents, categoryName, description }, and transfers
// between its accounts as { from, to, date, amountCents, description }.
function rowBuilders(rows) {
  return {
    add: (account, date, amountCents, categoryName, description) =>
      rows.push({ account, date, amountCents, categoryName, description }),
    transfer: (from, to, date, amountCents, description) =>
      rows.push({ from, to, date, amountCents, description }),
  };
}

function generateJohn(random, endDate) {
  const rows = [];
  const { add, transfer } = rowBuilders(rows);

  forEachMonth(endDate, (year, month) => {
    const day = (d) => isoDate(year, month, Math.min(d, daysInMonth(year, month)));

    add("Everyday", day(1), 110000, "Rent", "Monthly rent");
    add("Everyday", day(3), 3900, "Subscriptions", "Gym membership");
    add("Everyday", day(5), 1299, "Subscriptions", "Streaming");
    add("Everyday", day(10), 1499, "Subscriptions", "Phone plan");
    add("Everyday", day(27), 320000, "Salary", "Salary");
    transfer("Everyday", "Savings", day(28), 40000, "Monthly savings");

    for (const week of [2, 9, 16, 23]) {
      add("Everyday", day(week + random.int(0, 3)), random.cents(35, 95), "Groceries", random.pick(DESCRIPTIONS.groceries));
    }
    for (let i = random.int(2, 5); i > 0; i--) {
      add("Everyday", day(random.int(1, 28)), random.cents(2.5, 12), "Cafés & bars", random.pick(DESCRIPTIONS.cafes));
    }
    for (let i = random.int(1, 3); i > 0; i--) {
      add("Everyday", day(random.int(1, 28)), random.cents(25, 80), "Restaurants", random.pick(DESCRIPTIONS.restaurants));
    }
    for (let i = random.int(1, 2); i > 0; i--) {
      add("Everyday", day(random.int(1, 28)), random.cents(45, 70), "Car", "Fuel");
    }
    for (let i = random.int(0, 2); i > 0; i--) {
      add("Everyday", day(random.int(1, 28)), random.cents(10, 60), "Leisure", random.pick(DESCRIPTIONS.leisure));
    }
    for (let i = random.int(0, 2); i > 0; i--) {
      add("Everyday", day(random.int(1, 28)), random.cents(20, 150), "Shopping", random.pick(DESCRIPTIONS.shopping));
    }
    if (random.chance(0.25)) {
      add("Everyday", day(random.int(1, 28)), random.cents(15, 90), "Healthcare", random.pick(DESCRIPTIONS.health));
    }
    if (month === 3) add("Everyday", day(15), 48000, "Car", "Car insurance");
    if (month === 12) {
      for (let i = 0; i < 3; i++) {
        add("Everyday", day(random.int(10, 22)), random.cents(30, 120), "Gifts", "Christmas present");
      }
    } else if (random.chance(0.2)) {
      add("Everyday", day(random.int(1, 28)), random.cents(25, 70), "Gifts", random.pick(DESCRIPTIONS.gifts));
    }
    if ([3, 6, 9, 12].includes(month)) {
      add("Savings", day(30), random.cents(8, 15), "Interest", "Quarterly interest");
    }
    if (month === 8) add("Savings", day(5), random.cents(850, 1200), "Travel", "Summer holiday");
  });
  return rows;
}

function generateJane(random, endDate) {
  const rows = [];
  const { add, transfer } = rowBuilders(rows);

  forEachMonth(endDate, (year, month) => {
    const day = (d) => isoDate(year, month, Math.min(d, daysInMonth(year, month)));

    add("Personal", day(1), 95000, "Rent", "Monthly rent");
    add("Personal", day(4), 4500, "Subscriptions", "Yoga classes");
    add("Personal", day(8), 999, "Subscriptions", "Music streaming");
    add("Personal", day(8), 299, "Subscriptions", "Cloud storage");
    add("Freelance", day(2), 5299, "Software", "Design software");
    add("Freelance", day(5), 18000, "Coworking", "Coworking desk");
    transfer("Freelance", "Personal", day(25), 200000, "Owner draw");

    for (let i = random.int(2, 3); i > 0; i--) {
      add("Freelance", day(random.int(3, 24)), random.cents(600, 2400), "Client work", `Invoice #${year}-${pad(month)}${i}`);
    }
    for (const week of [3, 10, 17, 24]) {
      add("Personal", day(week + random.int(0, 3)), random.cents(25, 80), "Groceries", random.pick(DESCRIPTIONS.groceries));
    }
    for (let i = random.int(3, 6); i > 0; i--) {
      add("Personal", day(random.int(1, 28)), random.cents(2.5, 9), "Cafés & bars", random.pick(DESCRIPTIONS.cafes));
    }
    for (let i = random.int(1, 3); i > 0; i--) {
      add("Personal", day(random.int(1, 28)), random.cents(20, 65), "Restaurants", random.pick(DESCRIPTIONS.restaurants));
    }
    for (let i = random.int(1, 2); i > 0; i--) {
      add("Personal", day(random.int(1, 28)), random.cents(12, 55), "Leisure", random.pick(DESCRIPTIONS.leisure));
    }
    for (let i = random.int(0, 2); i > 0; i--) {
      add("Personal", day(random.int(1, 28)), random.cents(15, 120), "Shopping", random.pick(DESCRIPTIONS.shopping));
    }
    if (random.chance(0.3)) {
      add("Personal", day(random.int(1, 28)), random.cents(12, 80), "Healthcare", random.pick(DESCRIPTIONS.health));
    }
    if (random.chance(0.15)) {
      add("Freelance", day(random.int(1, 28)), random.cents(90, 450), "Shopping", random.pick(DESCRIPTIONS.equipment));
    }
    if (month === 12) {
      for (let i = 0; i < 2; i++) {
        add("Personal", day(random.int(10, 22)), random.cents(25, 90), "Gifts", "Christmas present");
      }
    } else if (random.chance(0.15)) {
      add("Personal", day(random.int(1, 28)), random.cents(20, 60), "Gifts", random.pick(DESCRIPTIONS.gifts));
    }
    if ([3, 6, 9, 11].includes(month)) {
      add("Freelance", day(16), random.cents(900, 1500), "Taxes", "Quarterly tax payment");
    }
  });
  return rows;
}

const PROFILES = [
  {
    username: "john.doe",
    accounts: [
      { name: "Everyday", color: "#2563EB", openingBalanceCents: 125000, isDefault: true },
      { name: "Savings", color: "#16A34A", openingBalanceCents: 500000 },
    ],
    generate: generateJohn,
    seed: 20250101,
  },
  {
    username: "jane.doe",
    accounts: [
      { name: "Personal", color: "#DB2777", openingBalanceCents: 82000, isDefault: true },
      { name: "Freelance", color: "#F59E0B", openingBalanceCents: 240000 },
    ],
    generate: generateJane,
    seed: 20250102,
  },
];

// ---- Safety checks
function assertSafeTarget(dataDir) {
  const resolved = path.resolve(dataDir);
  if (PROTECTED_DIRS.some((dir) => path.resolve(dir) === resolved)) {
    throw new Error(`Refusing to write demo data into ${resolved}: that is the real data directory.`);
  }
  const dbPath = path.join(resolved, "konto.db");
  if (!fs.existsSync(dbPath)) return;
  const Database = require("better-sqlite3");
  const existing = new Database(dbPath, { readonly: true });
  try {
    const users = existing.prepare("SELECT username FROM users").all().map((u) => u.username);
    const foreign = users.filter((u) => !DEMO_USERNAMES.includes(u));
    if (foreign.length) {
      throw new Error(
        `Refusing to overwrite ${dbPath}: it contains non-demo users (${foreign.join(", ")}).`,
      );
    }
  } finally {
    existing.close();
  }
}

// ---- Build
function seedDemo({ dataDir = DEFAULT_DATA_DIR, endDate = todayIso(), log = console.log } = {}) {
  assertSafeTarget(dataDir);
  fs.mkdirSync(dataDir, { recursive: true });
  for (const file of ["konto.db", "konto.db-journal", "sessions.db"]) {
    fs.rmSync(path.join(dataDir, file), { force: true });
  }

  const passwordHash = bcrypt.hashSync(DEMO_PASSWORD, 10);
  // The first demo user is created by the normal first-start path, so it is
  // the instance owner exactly as on a real install.
  const db = openDatabase({
    dbPath: path.join(dataDir, "konto.db"),
    dataDir,
    seedUsername: PROFILES[0].username,
    getSeedPasswordHash: () => passwordHash,
    seedLocale: "en",
    log: () => {},
  });

  const summary = [];
  db.transaction(() => {
    for (const profile of PROFILES) {
      let userId = db.prepare("SELECT id FROM users WHERE username = ?").get(profile.username)?.id;
      if (!userId) {
        userId = db
          .prepare("INSERT INTO users (username, password_hash) VALUES (?, ?)")
          .run(profile.username, passwordHash).lastInsertRowid;
        seedDefaultCategories(db, userId, "en");
        seedDefaultAccount(db, userId, "en");
      }

      const insertCategory = db.prepare(
        "INSERT INTO categories (user_id, name, color, type) VALUES (?, ?, ?, ?)",
      );
      for (const c of EXTRA_CATEGORIES[profile.username]) insertCategory.run(userId, c.name, c.color, c.type);

      // The default account from registration becomes the first demo account.
      const accountIds = {};
      const [first, ...others] = profile.accounts;
      const defaultAccount = db.prepare("SELECT id FROM accounts WHERE user_id = ?").get(userId);
      db.prepare(
        "UPDATE accounts SET name = ?, color = ?, opening_balance_cents = ?, is_default = 1 WHERE id = ?",
      ).run(first.name, first.color, first.openingBalanceCents, defaultAccount.id);
      accountIds[first.name] = defaultAccount.id;
      for (const account of others) {
        accountIds[account.name] = db
          .prepare(
            `INSERT INTO accounts (user_id, name, color, opening_balance_cents, is_default)
             VALUES (?, ?, ?, ?, 0)`,
          )
          .run(userId, account.name, account.color, account.openingBalanceCents).lastInsertRowid;
      }

      const types = Object.fromEntries(
        db
          .prepare("SELECT name, type FROM categories WHERE user_id = ?")
          .all(userId)
          .map((c) => [c.name, c.type]),
      );
      const rows = profile
        .generate(createRandom(profile.seed), endDate)
        .filter((row) => row.date <= endDate)
        .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
      const insertTransaction = db.prepare(
        `INSERT INTO transactions
           (user_id, account_id, date, amount_cents, type, category_name, description)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      );
      for (const row of rows) {
        if (row.from) {
          insertTransfer(db, {
            userId,
            fromAccountId: accountIds[row.from],
            toAccountId: accountIds[row.to],
            date: row.date,
            amountCents: row.amountCents,
            description: row.description,
          });
          continue;
        }
        if (!types[row.categoryName]) throw new Error(`Unknown demo category: ${row.categoryName}`);
        insertTransaction.run(
          userId,
          accountIds[row.account],
          row.date,
          row.amountCents,
          types[row.categoryName],
          row.categoryName,
          row.description,
        );
      }
      summary.push(`${profile.username}: ${rows.length} transactions in ${profile.accounts.length} accounts`);
    }
  })();
  db.close();

  log(`Demo database ready in ${path.resolve(dataDir)} (data up to ${endDate}):`);
  for (const line of summary) log(`  ${line}`);
  log(`  logins: ${DEMO_USERNAMES.join(", ")} / ${DEMO_PASSWORD}`);
}

if (require.main === module) {
  try {
    seedDemo({ dataDir: process.argv[2] || DEFAULT_DATA_DIR });
  } catch (err) {
    console.error(`✗ ${err.message}`);
    process.exit(1);
  }
}

module.exports = { seedDemo, DEMO_USERNAMES, DEMO_PASSWORD };
