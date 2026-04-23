<div align="center">

<img src="assets/logo.png" alt="VaultLens Logo" width="80" height="80">

# VaultLens

### A Modern Web UI for HashiCorp Vault

[![License](https://img.shields.io/badge/License-GPLv3-blue.svg)](LICENSE)
[![GitHub release](https://img.shields.io/github/v/release/Jasonrve/vaultlens?include_prereleases)](https://github.com/Jasonrve/vaultlens/releases)
[![Docker Image](https://img.shields.io/badge/ghcr.io-vaultlens-blue?logo=docker)](https://github.com/Jasonrve/vaultlens/pkgs/container/vaultlens)
[![CI](https://github.com/Jasonrve/vaultlens/actions/workflows/ci.yml/badge.svg)](https://github.com/Jasonrve/vaultlens/actions/workflows/ci.yml)

**Browse secrets. Visualize policies. Share securely. Manage Vault with confidence.**

[Getting Started](#-getting-started) · [Features](#-features) · [Screenshots](#-screenshots) · [Deployment](#-deployment) · [Contributing](CONTRIBUTING.md)

</div>

---

> **⚠️ Beta Notice:** VaultLens is currently in **beta** and under heavy development. 

> **Note:** VaultLens is a community-maintained project and has no affiliation with HashiCorp. It is an independent open-source tool built to enhance the Vault user experience.

---

## What is VaultLens?

VaultLens is a powerful, open-source web UI for [HashiCorp Vault](https://www.vaultproject.io/) that goes beyond the built-in Vault UI. It provides intuitive secret management, interactive policy visualizations, secure password sharing, automated secret rotation, backup/restore, webhook notifications, and a unified view of your Vault infrastructure — all from a single, lightweight application.

### Why I Created VaultLens

I created VaultLens because my organization needed a modern, user-friendly interface for Vault that the native UI didn't provide. As someone who has benefited from countless open-source projects, this is my contribution back to the community—built with the hope it will help others manage Vault with greater confidence and ease.

### Why VaultLens?

| | Native Vault UI | VaultLens |
|---|---|---|
| **Secret browsing** | Basic KV UI | Full KV v1/v2 with metadata editing |
| **Policy visualization** | Raw HCL text | Interactive relationship graphs |
| **Secret sharing** | Not available | End-to-end encrypted sharing via link |
| **Identity explorer** | Basic listing | Entity ↔ Group ↔ Policy graph |
| **Permission testing** | CLI only | Visual permission tester with graph |
| **Custom branding** | Not available | Custom logo, colors, app name |
| **Audit log viewer** | File-based only | Searchable, filterable web UI |
| **Secret rotation** | Not available | Automated password rotation scheduler |
| **Backup & restore** | Not available | Full KV backup with scheduling |
| **Webhooks** | Not available | Audit-driven webhook notifications |
| **Deployment** | Built into Vault | Standalone — Docker, Compose, Helm |

---

## ✨ Features

### Secret Management
Browse and manage secrets across all KV v1 and v2 engines. Create, edit, merge, and delete secrets with a clean interface. View and edit version info and custom metadata.


### Interactive Visualizations
Explore your Vault's structure through interactive node graphs powered by React Flow:

- **Auth → Role → Policy** — How authentication methods connect to policies
- **Policy → Secret Path** — Which policies grant access to which paths
- **Identity Chain** — Entity → Group → Policy relationships

### Permission Tester
Select any entity, enter a path and operation, and instantly see whether access is allowed or denied — with a full graph showing which policies contribute to the decision.

### Identity Management
Browse entities, groups, aliases, and their policy attachments. Explore the current user's identity chain with a visual graph.

### Policy Explorer
View, parse, and understand Vault ACL policies. See all path rules and their capabilities in a structured breakdown.

### Auth Method Management
List, configure, and tune all auth methods. Browse roles and their associated policies directly in the UI.

### Secret Auto-Rotation
Automatically rotate KV v2 secret values on a schedule using Vault's custom metadata. Set `rotate-interval` metadata on any secret and VaultLens handles the rest.

### Backup & Restore
Create instant or scheduled full backups of all KV secrets. Restore from any saved backup with one click.

### Webhook Notifications
Configure webhooks to be notified when secrets at specific paths are modified. VaultLens monitors the Vault audit log and fires HTTP POST requests with HMAC-signed payloads.

### Analytics Dashboard
View Vault health, seal status, version, storage backend, token counts, entity counters, and request metrics — all in one place.

### Audit Log Viewer
Browse Vault audit logs with full-text search, operation filtering, request/response detail inspection, and clickable resource links.

### Custom Branding
Customize VaultLens with your organization's logo, primary and secondary colors, and application name.

### Secure Secret Sharing
Share secrets safely with anyone — even people without Vault access. Secrets are encrypted in your browser using OpenPGP before leaving your machine. The server **never** sees the plaintext. Recipients open a link and decrypt entirely in their browser.

- End-to-end encrypted (OpenPGP AES-256)
- Configurable expiration (1 hour to 7 days)
- One-time view option — self-destructs after first retrieval
- No login required for recipients


---

## 📸 Screenshots

### Secret Engines & Secrets

![](<assets/secret engine.jpg>)

*Secrets Engines list showing KV v1/v2 and cubbyhole engines with type badges and accessor IDs.*

![](<assets/ability to see secret keys but not values.jpg>)

*Secret detail view — field names are visible but values are masked. Metadata panel shows version info, creation/update times, and editable custom metadata.*

---

### Auth Methods

![](<assets/Auth Method.jpg>)

*Auth Methods list showing type, description, and accessor for all configured authentication methods.*

![](<assets/Backend Auth roles view.jpg>)

*Auth method detail — browsing roles on the Kubernetes auth method with Roles, Configuration, and Method Options tabs.*

---

### ACL Policies

![](<assets/acl policies.jpg>)

*ACL Policies list with all policies including `vaultlens-admin`, `default`, and `root`.*

---

### Identity

![](<assets/entites.jpg>)

*Entities list showing identity entities with their UUIDs.*

![](<assets/groups.jpg>)

*Groups list showing identity groups with their UUIDs.*

![](<assets/identity.jpg>)

*Identity Chain — visual graph of the current user's entity, group memberships, policies, and permitted secret paths.*

---

### Visualizations

![](<assets/visualization.jpg>)

*Auth → Role → Policy graph: interactive React Flow diagram showing how auth methods (blue) connect through roles (orange) to policies (green).*

---

### Permission Tester

![](<assets/permissions tester.jpg>)

*Permission Tester — select any entity, specify a path and operation, and get an instant visual allow/deny result. The graph shows the full policy evaluation chain.*

---

### Analytics

![](<assets/analytics.jpg>)

*Vault Analytics — cluster health, seal status, version, storage backend, resource counts (engines, auth methods, policies, entities, groups), and internal counters.*

---

### Audit Log

![](<assets/audit logs.jpg>)

*Audit Log Viewer — searchable and filterable log with operation type badges, path links, remote address, user, entity, and expandable request/response detail panels.*

---

### Secret Auto-Rotation

![](<assets/secret rotation.jpg>)

*Secret Auto-Rotation — scheduler status with last/next check times, and instructions for registering secrets via KV v2 custom metadata (`rotate-interval`, `rotate-format`).*

---

### Backup & Restore

![](<assets/backup and restore.jpg>)

*Backup & Restore — backup schedule configuration with interval selector, list of saved backups with size, creation date, and one-click restore/delete actions.*

---

### Webhooks

![](<assets/webhooks.jpg>)

*Webhooks — configure HTTP endpoints to be notified when secrets at matching paths are modified, with HMAC-signed payloads.*

---

### Share a Secret

![](<assets/Share secret.jpg>)

*Share a Secret — end-to-end encrypted secret sharing with configurable expiration and one-time-view option. The decryption key is only in the share URL fragment and never sent to the server.*

---

### Branding

![](<assets/branding.jpg>)

*Branding — customize the application name, logo, primary color, secondary color, and background color with a live preview panel.*

---

## 🚀 Getting Started

### Docker (Fastest)

```bash
# Create persistent volumes for config and backups
docker volume create vaultlens_config
docker volume create vaultlens_backups

docker run -d \
  --name vaultlens \
  -p 3001:3001 \
  -e VAULT_ADDR=http://your-vault-server:8200 \
  -e VAULT_SYSTEM_TOKEN=your-system-token \
  -e VAULTLENS_CONFIG_STORAGE=file \
  -e VAULTLENS_CONFIG_PATH=/config \
  -e VAULTLENS_BACKUP_PATH=/backups \
  -v vaultlens_config:/config \
  -v vaultlens_backups:/backups \
  ghcr.io/Jasonrve/vaultlens:latest
```

Open **http://localhost:3001** and log in with your Vault token.

### Docker Compose

```bash
# Set required variables
export VAULT_ADDR=http://your-vault-server:8200
export VAULT_SYSTEM_TOKEN=your-system-token

docker compose up -d
```

The included `docker-compose.yml` creates two named volumes automatically:
- **`vaultlens_config`** — persists branding, webhooks, and rotation config (`/config`)
- **`vaultlens_backups`** — persists backup JSON files (`/backups`)


App: http://localhost:3001 · Vault UI: http://localhost:8200 · Login token: `root`

---

## 📦 Deployment

VaultLens supports multiple deployment methods:

| Method | Best For |
|--------|----------|
| **Docker Run** | Quick testing, single server |
| **Docker Compose** | Small/medium deployments |
| **Helm / Kubernetes** | Production K8s clusters |

### Configuration

| Environment Variable | Required | Default | Description |
|---------------------|----------|---------|-------------|
| `VAULT_ADDR` | Yes | — | HashiCorp Vault server URL |
| `VAULT_SYSTEM_TOKEN` | Yes* | — | Vault token for system operations |
| `VAULT_K8S_AUTH_ROLE` | Yes* | — | K8s auth role (replaces `VAULT_SYSTEM_TOKEN` in K8s) |
| `PORT` | No | `3001` | Application port |
| `NODE_ENV` | No | `production` | Environment mode |
| `VAULT_SKIP_TLS_VERIFY` | No | `false` | Skip TLS certificate verification |
| `CORS_ORIGIN` | No | — | Allowed CORS origin (only if frontend is on a different origin) |
| `VAULTLENS_CONFIG_STORAGE` | No | `file` | Config backend: `file` or `vault` |
| `VAULTLENS_CONFIG_PATH` | No | `/config` | Directory for `config.ini` and logo blobs (file mode) |
| `VAULTLENS_BACKUP_PATH` | No | `/backups` | Directory for backup JSON files |
| `VAULT_AUDIT_LOG_PATH` | No | — | Path to Vault audit log file (required for webhooks) |
| `RATE_LIMIT_MAX` | No | `500` | Max API requests per window |
| `RATE_LIMIT_WINDOW_MS` | No | `900000` | Rate limit window in ms (15 min) |

*Either `VAULT_SYSTEM_TOKEN` or `VAULT_K8S_AUTH_ROLE` is required for full functionality.

### VaultLens Policies

VaultLens uses two auto-created Vault policies to separate concerns between user-initiated operations and background services. VaultLens automatically creates both policies on startup if they don't already exist.

#### `vaultlens-admin` — Admin UI Access

**Purpose:** UI access control flag for administrative features. Does NOT grant broad Vault access.

**Assign to:** Human administrators and users who need access to VaultLens admin features (backup, branding, webhooks, rotation scheduler, analytics, audit logs).

---

#### `vaultlens-system` — System Token (Background Services)

**Purpose:** Full permissions for VaultLens background services. Do NOT assign to human users.

**Used by:** VaultLens system token (AppRole or Kubernetes auth) for background operations only.

**Background services that use this token:**
- 🔄 **Secret rotation scheduler** — Reads and rotates KV v2 secrets based on `rotate-interval` metadata
- 👁️ **Audit log watcher** — Monitors Vault audit log, fires webhook HTTP callbacks
- 💾 **Backup scheduler** — Creates and manages full KV secret backups
- 🔗 **Shared secrets** — Encrypts secrets in the cubbyhole for password sharing
- ⚡ **Policy initialization** — Auto-creates `vaultlens-admin` and `vaultlens-system` policies on startup
- 🔊 **Audit device registration** — Auto-registers socket audit device for webhooks

---

### Kubernetes / Helm

```bash
helm install vaultlens ./charts/vaultlens \
  --set config.vaultAddr=http://vault:8200 \
  --set kubernetesAuth.enabled=true \
  --set kubernetesAuth.role=vaultlens \
  --set backup.persistence.enabled=true \
  --set configStorage.persistence.enabled=true
```

For stateless multi-replica deployments, set `configStorage.backend=vault` to store configuration in Vault KV instead of a PVC.

See [charts/vaultlens/values.yaml](charts/vaultlens/values.yaml) for all configurable parameters.

---

## 🔒 Security

VaultLens is designed with security as a first-class concern:

- **Token isolation** — User tokens enforce Vault ACL; the system token is never exposed to the frontend
- **HTTP-only cookies** — Vault tokens stored in secure, HTTP-only, SameSite=lax cookies
- **CSRF protection** — Double-submit cookie pattern on all state-changing routes
- **End-to-end encryption** — Shared secrets encrypted client-side with OpenPGP; server never sees plaintext
- **URL fragment key transport** — Decryption keys live in `#fragment`, never sent to the server
- **SSRF protection** — Webhook URLs validated against internal/cloud metadata address blocklist
- **Security headers** — Helmet.js provides CSP, HSTS, X-Frame-Options, Referrer-Policy
- **Rate limiting** — Global rate limiter + stricter limit on public sharing endpoint
- **Input validation** — Secret data, auth configs, webhook URLs, backup filenames, rotation intervals
- **Non-root container** — Runs as UID 1001

For the full security model and audit history, see [docs/security.md](docs/security.md) and [docs/SECURITY_AUDIT.md](docs/SECURITY_AUDIT.md).

---

## 🏗 Architecture

```
┌─────────────────────────────────────────────────┐
│              Browser (React SPA)                 │
│  React 19 · TypeScript · TailwindCSS · Zustand   │
│  React Query · React Flow · OpenPGP.js           │
├─────────────────────────────────────────────────┤
│              Node.js / Express API               │
│  14 route modules · Helmet · CSRF · Rate Limit   │
│  Background: Rotation · Backup · Audit Watcher   │
│  Config Storage: file (INI) or Vault KV          │
├─────────────────────────────────────────────────┤
│              HashiCorp Vault                      │
│  KV v1/v2 · ACL Policies · Auth Methods          │
│  Identity (Entities/Groups) · Audit Log          │
└─────────────────────────────────────────────────┘
```

VaultLens runs as a **single unified process** — the Express server serves both the API and the built React SPA. No separate frontend server is needed.

For detailed architecture documentation, see [docs/architecture.md](docs/architecture.md).

---

## 🤝 Contributing

We welcome contributions! Please read our [Contributing Guide](CONTRIBUTING.md) to get started.

- [Report a Bug](https://github.com/Jasonrve/vaultlens/issues/new?template=bug_report.md)
- [Request a Feature](https://github.com/Jasonrve/vaultlens/issues/new?template=feature_request.md)
- [Development Guide](docs/development.md)

---

## 📄 License

VaultLens is licensed under the [GNU General Public License v3.0](LICENSE).

This means you are free to use, modify, and distribute this software, but any derivative works must also be released under the GPLv3.

---

<div align="center">
  <sub>Built with ❤️ for the HashiCorp Vault community</sub>
</div>