const fs = require("fs");
const path = require("path");

// Reads backend/.env by hand (never committed), so no secret is ever written
// in this file, which is versioned.
function loadEnvFile(filePath) {
  const result = {};
  if (!fs.existsSync(filePath)) return result;
  fs.readFileSync(filePath, "utf-8")
    .split("\n")
    .forEach((line) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) return;
      const idx = trimmed.indexOf("=");
      if (idx === -1) return;
      result[trimmed.slice(0, idx).trim()] = trimmed.slice(idx + 1).trim();
    });
  return result;
}

const backendEnv = loadEnvFile(path.join(__dirname, "backend", ".env"));

function required(name) {
  const value = backendEnv[name] || process.env[name];
  if (!value) {
    throw new Error(
      `Missing ${name} in backend/.env: cannot start in production.`,
    );
  }
  return value;
}

module.exports = {
  apps: [
    {
      name: "konto",
      script: "./backend/server.js",

      error_file: "./logs/err.log",
      out_file: "./logs/out.log",
      log_date_format: "YYYY-MM-DD HH:mm Z",

      // Production environment (values from backend/.env)
      env: {
        NODE_ENV: "production",
        PORT: backendEnv.PORT || "8443",

        KONTO_USER: required("KONTO_USER"),
        KONTO_PASS: required("KONTO_PASS"),
        SESSION_SECRET: required("SESSION_SECRET"),
        SESSION_MAX_AGE_DAYS: backendEnv.SESSION_MAX_AGE_DAYS || "30",

        // HTTPS certificate paths (not secrets). If you don't set them in
        // backend/.env, replace the placeholders below with the absolute paths
        // on your server (e.g. the files created by `tailscale cert`).
        SSL_CERT_PATH:
          backendEnv.SSL_CERT_PATH || "/path/to/tailnet-certs/<host-name>.crt",
        SSL_KEY_PATH:
          backendEnv.SSL_KEY_PATH || "/path/to/tailnet-certs/<host-name>.key",
      },
    },
  ],
};
