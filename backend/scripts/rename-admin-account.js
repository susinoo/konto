// Renames the oldest user (usually the seed user) and sets their password,
// both read from backend/.env (KONTO_USER / KONTO_PASS). The user keeps the
// same id, so all their data stays attached: only the credentials change.
// Open sessions of that user are invalidated.
//
// Usage: node scripts/rename-admin-account.js

const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env"), quiet: true });

const bcrypt = require("bcryptjs");
const { openExistingDatabase } = require("../db");

const newUsername = process.env.KONTO_USER;
const newPassword = process.env.KONTO_PASS;

if (!newUsername || !newPassword) {
  console.error("Set KONTO_USER and KONTO_PASS in backend/.env before running this script.");
  process.exit(1);
}

const db = openExistingDatabase({ dataDir: process.env.KONTO_DATA_DIR });

const user = db.prepare("SELECT id, username FROM users ORDER BY id ASC LIMIT 1").get();
if (!user) {
  console.error("The database has no users: nothing to rename.");
  process.exit(1);
}

const passwordHash = bcrypt.hashSync(String(newPassword), 10);
db.prepare(
  "UPDATE users SET username = ?, password_hash = ?, session_version = session_version + 1 WHERE id = ?",
).run(String(newUsername), passwordHash, user.id);

console.log(
  `User id=${user.id} renamed from "${user.username}" to "${newUsername}". Restart the server and log in with the new credentials.`,
);
