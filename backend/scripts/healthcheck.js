// Container health check: exits 0 if the server answers GET /api/config on
// this machine, 1 otherwise. Speaks HTTPS when the server does (production
// with certificate files), without verifying the certificate: it only checks
// that the local process is alive.
//
// Usage: node scripts/healthcheck.js   (used by the Dockerfile HEALTHCHECK)

const fs = require("fs");
const path = require("path");
const http = require("http");
const https = require("https");

const isDev = process.env.NODE_ENV === "development";
const port = process.env.PORT || (isDev ? 3000 : 8443);
const certPath = process.env.SSL_CERT_PATH || path.join(__dirname, "..", "server.crt");
const keyPath = process.env.SSL_KEY_PATH || path.join(__dirname, "..", "server.key");
const useHttps = !isDev && fs.existsSync(certPath) && fs.existsSync(keyPath);

const request = (useHttps ? https : http).get(
  { host: "127.0.0.1", port, path: "/api/config", timeout: 4000, rejectUnauthorized: false },
  (res) => process.exit(res.statusCode === 200 ? 0 : 1),
);
request.on("timeout", () => request.destroy());
request.on("error", () => process.exit(1));
