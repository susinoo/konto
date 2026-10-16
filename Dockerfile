# Konto: one image with the backend and the built frontend.
#
#   docker compose up -d --build        (see docker-compose.yml)
#
# Debian slim rather than Alpine: better-sqlite3 ships prebuilt binaries for
# glibc, so no compiler is needed in any stage.

ARG NODE_VERSION=24

# ---- Frontend build
FROM node:${NODE_VERSION}-bookworm-slim AS frontend
WORKDIR /app/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# ---- Backend production dependencies
FROM node:${NODE_VERSION}-bookworm-slim AS backend
WORKDIR /app/backend
COPY backend/package.json backend/package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# ---- Runtime
FROM node:${NODE_VERSION}-bookworm-slim
WORKDIR /app

# Fixed for the container. Secrets and the other settings come from
# backend/.env at run time (docker-compose.yml), never from the image.
ENV NODE_ENV=production \
    PORT=3000 \
    HOST=0.0.0.0 \
    KONTO_DATA_DIR=/data

COPY --from=backend /app/backend/node_modules backend/node_modules
COPY backend/ backend/
COPY --from=frontend /app/frontend/dist frontend/dist

# Databases, sessions and backups live in /data, owned by the unprivileged
# `node` user (uid 1000) the app runs as.
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME /data
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD ["node", "backend/scripts/healthcheck.js"]

CMD ["node", "backend/server.js"]
