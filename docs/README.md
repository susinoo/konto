# Documentation

| Page | Contents |
| --- | --- |
| [Installation](installation.md) | Docker (recommended) and manual install with PM2 |
| [HTTPS](https.md) | `tailscale serve`, Tailscale sidecar container, certificate files |
| [Configuration](configuration.md) | Every setting in `backend/.env` |
| [Backups](backups.md) | Consistent snapshots with `backup.js`, cron and cloud upload |
| [Upgrading](upgrading.md) | Updates and the automatic migration from 1.x |
| [Maintenance scripts](maintenance.md) | Password reset, owner flag, backups |
| [Security model](security-model.md) | What Konto protects on its own and what is left to you |

How the code works internally (data model, migrations, auth, conventions) is in [ARCHITECTURE.md](../ARCHITECTURE.md).
