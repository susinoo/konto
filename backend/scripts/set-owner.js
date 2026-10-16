// Grants or revokes the owner flag on a user. Owners can download the full
// database backup from Settings; the app never moves the flag on its own, not
// even when the owner deletes their account. Use this script to appoint a
// backup admin or to revoke the role.
//
// Usage: node scripts/set-owner.js <username> [on|off]   (default: on)

const { openExistingDatabase } = require("../db");

const [, , username, action] = process.argv;

if (!username) {
  console.error("Usage: node scripts/set-owner.js <username> [on|off]");
  process.exit(1);
}

const grant = action !== "off";
const db = openExistingDatabase({ dataDir: process.env.KONTO_DATA_DIR });

const user = db.prepare("SELECT id FROM users WHERE username = ?").get(username);
if (!user) {
  console.error(`No user found with username "${username}".`);
  process.exit(1);
}

db.prepare("UPDATE users SET is_owner = ? WHERE id = ?").run(grant ? 1 : 0, user.id);

console.log(
  grant
    ? `✓ "${username}" (id=${user.id}) is now an owner and can download the database backup.`
    : `✓ Owner role removed from "${username}" (id=${user.id}).`,
);
