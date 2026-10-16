// express-session store on SQLite (better-sqlite3), in its own database file.
//
// Table layout: sessions (sid, sess, expire), with `sess` the session as JSON
// and `expire` an ISO 8601 UTC timestamp. Databases written by the store used
// before (better-sqlite3-session-store) have the same layout, so existing
// sessions stay valid.

const { Store } = require("express-session");

const CLEANUP_INTERVAL_MS = 15 * 60 * 1000;
// Only for sessions without a cookie expiry (not the case in Konto, where
// every session cookie has a maxAge).
const FALLBACK_TTL_MS = 24 * 60 * 60 * 1000;

class SqliteSessionStore extends Store {
  constructor(db, { cleanupIntervalMs = CLEANUP_INTERVAL_MS } = {}) {
    super();
    this.db = db;
    db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        sid TEXT NOT NULL PRIMARY KEY,
        sess JSON NOT NULL,
        expire TEXT NOT NULL
      )
    `);
    this.statements = {
      get: db.prepare("SELECT sess FROM sessions WHERE sid = ? AND expire > ?"),
      set: db.prepare("INSERT OR REPLACE INTO sessions (sid, sess, expire) VALUES (?, ?, ?)"),
      touch: db.prepare("UPDATE sessions SET expire = ? WHERE sid = ?"),
      destroy: db.prepare("DELETE FROM sessions WHERE sid = ?"),
      clearExpired: db.prepare("DELETE FROM sessions WHERE expire <= ?"),
    };
    // unref(): the timer alone never keeps the process alive.
    this.cleanupTimer = setInterval(() => this.clearExpired(), cleanupIntervalMs);
    this.cleanupTimer.unref();
  }

  // Runs a statement and reports through the express-session callback.
  #run(callback, work) {
    let result;
    try {
      result = work();
    } catch (err) {
      return callback?.(err);
    }
    callback?.(null, result);
  }

  #expiry(sess) {
    const expires = sess?.cookie?.expires;
    const date = expires ? new Date(expires) : new Date(Date.now() + FALLBACK_TTL_MS);
    return date.toISOString();
  }

  get(sid, callback) {
    this.#run(callback, () => {
      const row = this.statements.get.get(sid, new Date().toISOString());
      return row ? JSON.parse(row.sess) : null;
    });
  }

  set(sid, sess, callback) {
    this.#run(callback, () => {
      this.statements.set.run(sid, JSON.stringify(sess), this.#expiry(sess));
    });
  }

  // Called on requests that do not modify the session (rolling sessions):
  // only the expiry moves forward.
  touch(sid, sess, callback) {
    this.#run(callback, () => {
      this.statements.touch.run(this.#expiry(sess), sid);
    });
  }

  destroy(sid, callback) {
    this.#run(callback, () => {
      this.statements.destroy.run(sid);
    });
  }

  clearExpired() {
    try {
      return this.statements.clearExpired.run(new Date().toISOString()).changes;
    } catch (err) {
      console.error("Session cleanup failed:", err);
      return 0;
    }
  }

  close() {
    clearInterval(this.cleanupTimer);
    this.db.close();
  }
}

module.exports = { SqliteSessionStore };
