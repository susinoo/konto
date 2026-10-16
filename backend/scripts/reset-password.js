// Interactive: resets a locked-out user's password to a random temporary
// one, generated on every run (never a fixed value: the code is public, so a
// known password could be guessed by anyone between the reset and the
// change). Run it on the server, give the temporary password to the user,
// who then changes it from Settings > Account > Change password.
//
// The reset also invalidates all the user's open sessions.
//
// Usage: node scripts/reset-password.js   (asks for the username)

const crypto = require("crypto");
const readline = require("readline");
const bcrypt = require("bcryptjs");
const { openExistingDatabase } = require("../db");

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = (question) => new Promise((resolve) => rl.question(question, resolve));

async function main() {
  const username = (await ask("Username to reset: ")).trim();
  rl.close();

  if (!username) {
    console.error("Invalid username.");
    process.exit(1);
  }

  const db = openExistingDatabase({ dataDir: process.env.KONTO_DATA_DIR });

  const user = db.prepare("SELECT id FROM users WHERE username = ?").get(username);
  if (!user) {
    console.error(`✗ No user found with username "${username}".`);
    process.exit(1);
  }

  // 12 random bytes in base64url = 16 characters, easy to copy.
  const newPassword = crypto.randomBytes(12).toString("base64url");
  const passwordHash = bcrypt.hashSync(newPassword, 10);
  db.prepare(
    "UPDATE users SET password_hash = ?, session_version = session_version + 1 WHERE id = ?",
  ).run(passwordHash, user.id);

  // Read the row back to make sure the new hash was actually stored.
  const updated = db.prepare("SELECT password_hash FROM users WHERE id = ?").get(user.id);
  if (!bcrypt.compareSync(newPassword, String(updated?.password_hash))) {
    console.error(`✗ Verification failed: the password of "${username}" was not updated.`);
    process.exit(1);
  }

  console.log(`✓ Password of "${username}" (id=${user.id}) updated and verified.`);
  console.log(`  Temporary password: ${newPassword}`);
  console.log("  Give it to the user: they must change it from Settings > Account.");
}

main();
