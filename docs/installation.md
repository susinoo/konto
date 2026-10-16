# Installation

Konto runs as a single process that serves both the API and the built frontend. Install it with **Docker** (recommended) or **manually** with Node.js and a process manager. Either way, keep it on a private network and put [HTTPS](https.md) in front of it.

## With Docker (recommended)

Requirements: Docker with the Compose plugin.

```bash
git clone https://github.com/susinoo/Konto.git
cd Konto
cp backend/.env.example backend/.env   # set KONTO_USER, KONTO_PASS, SESSION_SECRET
mkdir -p data                          # database, sessions and backups
docker compose up -d --build
```

The app listens on `http://127.0.0.1:3000`, on the host only: nothing on the network can reach it until you add HTTPS in front of it ([HTTPS](https.md)). Check it with `docker compose ps` (it reports `healthy`) and `docker compose logs -f`.

- **Configuration** comes from `backend/.env`, the same file as the manual install ([Configuration](configuration.md)). `NODE_ENV`, `PORT`, `HOST`, `KONTO_DATA_DIR` and `TRUST_PROXY` are fixed by [`docker-compose.yml`](../docker-compose.yml) and ignored there. Set `KONTO_PORT` in your shell to publish another host port.
- **Data** lives in `./data` on the host (`konto.db`, `sessions.db`, `backups/`), plain files you can back up ([Backups](backups.md)). The container runs as the unprivileged user with uid 1000: `./data` must be writable by it, which is the case when it was created by the first user of a typical Linux or macOS machine. Otherwise run `sudo chown 1000:1000 data`.
- **Updating**: `git pull && docker compose up -d --build`. Database migrations run automatically at startup, after a backup ([Upgrading](upgrading.md)).
- **Maintenance scripts** run inside the container, e.g. `docker compose exec -it konto node backend/scripts/reset-password.js`.
- **Moving from a manual install**: stop the old process, copy the contents of `backend/data/` into `./data`, then start the container.

## Manual install (PM2)

Requirements: Node.js 22 or newer (24 recommended). The examples use [PM2](https://pm2.keymetrics.io/), but any process manager (systemd, etc.) works.

### Option A — from scratch, with git

1. **Install**:

   ```bash
   git clone https://github.com/susinoo/Konto.git
   cd Konto
   cd backend && npm install && cd ../frontend && npm install && npm run build && cd ..
   ```

2. **Configure** `backend/.env`: copy `backend/.env.example` and set at least `KONTO_USER`, `KONTO_PASS` and `SESSION_SECRET` (generate one with `openssl rand -hex 32`). See [Configuration](configuration.md). This is the only file that holds secrets: both `backend/server.js` and `ecosystem.config.js` read from it.

3. **HTTPS**: see [HTTPS](https.md). Without certificates and without a proxy, the server starts in plain HTTP.

4. **Start**:

   ```bash
   pm2 start ecosystem.config.js
   pm2 logs konto
   ```

   The server refuses to start if `KONTO_USER`, `KONTO_PASS` or `SESSION_SECRET` are missing.

### Option B — prebuilt package (updating an existing install)

```bash
./deploy.sh
```

This builds the frontend and assembles a `deploy/` folder (backend without `.env`, data or `node_modules`, the built frontend and `ecosystem.config.js`). It runs nothing remotely: it prints the follow-up commands, using `$DEPLOY_HOST` (`user@host` or an `~/.ssh/config` alias) and `$DEPLOY_PATH` if they are set:

```bash
rsync -avz --delete \
  --exclude='backend/.env' --exclude='backend/data' --exclude='backend/dati' \
  --exclude='backend/node_modules' --exclude='logs' \
  deploy/ "$DEPLOY_HOST:$DEPLOY_PATH/"
ssh "$DEPLOY_HOST" "cd $DEPLOY_PATH/backend && npm install && pm2 restart konto"
```

> **The `--exclude` flags are mandatory.** Without them, `--delete` would remove the server's `.env`, its database (`data/`, or the legacy `dati/`), `node_modules` and the PM2 logs. `npm install` runs on the server so that `better-sqlite3`'s native bindings are compiled for that machine.
