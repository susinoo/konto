# Configuration

All settings live in `backend/.env`, which is never committed (template: [`backend/.env.example`](../backend/.env.example)).

| Variable | Description |
| --- | --- |
| `NODE_ENV` | `development` → HTTP on port 3000 with insecure dev defaults. Any other value → production (default port 8443). |
| `PORT` | Listening port (optional). |
| `HOST` | Interface to listen on (default: all). `127.0.0.1` keeps the HTTP port off the network when a local proxy such as `tailscale serve` handles HTTPS. |
| `KONTO_USER` / `KONTO_PASS` | Credentials of the seed user, created only when the `users` table is empty. **Required in production.** |
| `SESSION_SECRET` | Session signing key. **Required in production.** Use a long random value. |
| `SESSION_MAX_AGE_DAYS` | Session lifetime in days (default `30`). Renewed on every request. |
| `SSL_CERT_PATH` / `SSL_KEY_PATH` | Absolute paths to the HTTPS certificate and key (production only, optional). |
| `REGISTRATION_ENABLED` | `true` to show "Sign up" on the login page and accept `POST /api/auth/register`. **Default: disabled.** |
| `KONTO_CURRENCY` | Currency of the instance as an ISO 4217 code (default `EUR`). Amounts are stored without a currency. |
| `KONTO_LOCALE` | Language of the seed user's default categories and account, `en` or `it` (default `en`). Users who sign up later get them in their browser language. |
| `TRUST_PROXY` | Only when running behind a reverse proxy: number of trusted hops, `loopback`, or a list of IPs/subnets ([Express docs](https://expressjs.com/en/guide/behind-proxies.html)). |
| `KONTO_DATA_DIR` | Directory for `konto.db` and `sessions.db` (default `backend/data/`). |
