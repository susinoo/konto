# Security model

Konto is built for a **small, trusted group of users on a private network**. It is not designed or tested as a public internet service.

What the app does on its own:

- Session cookies are `httpOnly`, `SameSite=Lax` and `Secure` over HTTPS. Sessions are regenerated at login and invalidated on other devices after a password change, a password reset or an account deletion.
- Passwords are hashed with bcrypt. Login, sign-up and password confirmations are rate-limited per IP, and login takes the same time whether or not the username exists.
- Security headers via `helmet`, including a strict same-origin Content Security Policy and clickjacking protection.
- Requests that change data must come from the app's own origin (CSRF defense in addition to `SameSite`).
- All queries are scoped to the logged-in user. The integration tests check that no user can read or modify another user's data.
- Server-side input validation, JSON error responses without stack traces, and CSV export protected against formula injection.

What it leaves to you:

- **Network exposure.** Keep the app on a private network (Tailscale, WireGuard, a VPN) or behind a reverse proxy with TLS. Keep `REGISTRATION_ENABLED` off unless everyone who can reach the URL is allowed to create an account.
- **Backups.** Snapshot the database regularly with [`backup.js`](backups.md) and keep the copies on another machine.
- **Instance owner.** The user flagged as *owner* can download the whole database, including other users' data and password hashes. On a fresh install the seed user is the owner; see [`set-owner.js`](maintenance.md).

Found a vulnerability? Please read [SECURITY.md](../SECURITY.md).
