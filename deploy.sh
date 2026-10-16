#!/bin/bash
# deploy.sh - Builds a deploy/ folder ready to be copied to the production server.
#
# It runs nothing remotely: at the end it prints the commands to run by hand.
# DEPLOY_HOST and DEPLOY_PATH are optional; without them the printed commands
# contain placeholders. To avoid typing them every time, export them from your
# (never versioned) shell profile, e.g.:
#   export DEPLOY_HOST=my-user@100.x.x.x   # user@host, a hostname, or an
#                                          # alias from ~/.ssh/config
#   export DEPLOY_PATH=/home/my-user/apps/konto

set -e

DEPLOY_DIR="./deploy"
DEPLOY_HOST="${DEPLOY_HOST:-<host>}"
DEPLOY_PATH="${DEPLOY_PATH:-<project-path>}"

# Server-side paths that rsync --delete must never touch: secrets, data
# (current and legacy location), installed dependencies and PM2 logs.
RSYNC_EXCLUDES="--exclude='backend/.env' --exclude='backend/data' --exclude='backend/dati' --exclude='backend/node_modules' --exclude='logs'"

echo "🚀 Preparing the Konto deploy package..."

echo "1️⃣ Cleaning the old deploy folder..."
rm -rf "$DEPLOY_DIR"
mkdir -p "$DEPLOY_DIR"

echo "2️⃣ Building the frontend..."
npm run build --prefix frontend

echo "3️⃣ Copying the backend (without .env, data, demo data, node_modules, tests and local files)..."
mkdir -p "$DEPLOY_DIR/backend"
rsync -av --exclude '.env' --exclude 'data' --exclude 'dati' --exclude 'demo-data' --exclude 'node_modules' \
  --exclude 'test' --exclude '.DS_Store' --exclude 'spese.csv' \
  ./backend/ "$DEPLOY_DIR/backend/"

echo "4️⃣ Copying frontend/dist..."
mkdir -p "$DEPLOY_DIR/frontend"
cp -r ./frontend/dist "$DEPLOY_DIR/frontend/"

echo "5️⃣ Copying ecosystem.config.js..."
cp ./ecosystem.config.js "$DEPLOY_DIR/"

echo "6️⃣ Removing stray .DS_Store files (Finder may recreate them after the build)..."
find "$DEPLOY_DIR" -name '.DS_Store' -delete

echo ""
echo "✅ Deploy package ready in: $DEPLOY_DIR/"
echo ""
echo "📋 Next steps (run them by hand):"
echo "1. Copy deploy/ to the server. rsync is incremental and --delete removes"
echo "   files deleted locally. The excludes are MANDATORY: without them --delete"
echo "   would wipe the server's .env, its database (data/ or the legacy dati/),"
echo "   node_modules and the PM2 logs:"
echo "   rsync -avz --delete $RSYNC_EXCLUDES deploy/ $DEPLOY_HOST:$DEPLOY_PATH/"
echo ""
echo "2. SSH into the server:"
echo "   ssh $DEPLOY_HOST"
echo ""
echo "3. Install dependencies (rebuilds native modules) and restart:"
echo "   cd $DEPLOY_PATH/backend && npm install && pm2 restart konto"
echo ""
