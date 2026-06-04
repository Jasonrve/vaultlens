# Architecture Overview

VaultLens is a unified full-stack application with a React SPA frontend served by an Express backend from the same Node.js process.

## Stack

| Layer | Technology |
|-------|-----------|
| Runtime | Node.js 22 |
| Backend | Express 4 |
| Frontend | React 19 + Vite |
| Language | TypeScript 5 |
| Styling | TailwindCSS 4 |
| State | Zustand + TanStack Query |
| Routing | react-router-dom 7 |
| Graphs | @xyflow/react |
| Encryption | OpenPGP.js |

## Request Flow

```
Browser
  │
  ├─ GET /  → Vite-built React SPA (static from dist/client/)
  │
  └─ /api/* → Express routes
               │
               ├─ authMiddleware  (validates vault_token cookie via /auth/token/lookup-self)
               ├─ csrfMiddleware  (double-submit cookie)
               │
               └─ Route handler
                    │
                    └─ vaultClient (proxies to Vault using req.vaultToken)
```

## Authentication Model

VaultLens is a **thin proxy** — it does not maintain its own user database. Every authenticated request uses the logged-in user's Vault token to call Vault. Vault's own ACL engine controls what each user can see and do.

The only time a different token is used is for background services and restricted-access fallbacks, which use the [system token](/architecture/system-token).

## Backend Route Modules

| Module | Mount | Description |
|--------|-------|-------------|
| `auth.ts` | `/api/auth` | Login, logout, session, OIDC |
| `secrets.ts` | `/api/secrets` | KV CRUD, merge, restricted access |
| `policies.ts` | `/api/policies` | ACL policy list and read |
| `authMethods.ts` | `/api/auth-methods` | Auth method config and roles |
| `identity.ts` | `/api/identity` | Entities and groups |
| `graph.ts` | `/api/graph` | React Flow graph data |
| `permissions.ts` | `/api/permissions` | Permission testing |
| `audit.ts` | `/api/audit` | Audit log and devices |
| `sys.ts` | `/api/sys` | Health, seal status |
| `rotation.ts` | `/api/rotation` | Secret rotation config |
| `backup.ts` | `/api/backup` | Backup and restore |
| `hooks.ts` | `/api/hooks` | Webhook CRUD |
| `branding.ts` | `/api/branding` | App branding |
| `sharing.ts` | `/api/sharing` | Encrypted secret sharing |

## Middleware Stack

| # | Middleware | Purpose |
|---|-----------|---------|
| 1 | Request ID | UUID per request for log correlation |
| 2 | Permissions-Policy | Denies all browser feature APIs |
| 3 | Helmet | CSP, HSTS, X-Frame-Options |
| 4 | CORS | Only active when `CORS_ORIGIN` is set |
| 5 | Morgan | HTTP request logging |
| 6 | Cookie Parser | `vault_token` and `csrf_token` cookies |
| 7 | JSON Body | 1 MB limit |
| 8 | Rate Limiter | Global on `/api/*` |
| 9 | HPP | HTTP parameter pollution protection |
| 10 | Health Check | `GET /api/health` (always public) |
| 11 | Auth Routes | Mounted before CSRF (login creates sessions) |
| 12 | CSRF | Double-submit cookie |
| 13 | Branding + Sharing | Mixed public/protected |
| 14 | Protected Routes | All other `/api/*` routes |
| 15 | Error Handler | Generic messages, no stack traces |

## Background Services

Three services start automatically at server boot (when system token is available):

| Service | Interval | Purpose |
|---------|----------|---------|
| Rotation Scheduler | 60 s | Rotates secrets with `rotate-interval` metadata |
| Audit Watcher | 5 s | Polls audit log, fires webhooks on matches |
| Backup Scheduler | Configurable | Creates full KV backups on schedule |

## Config Storage

VaultLens stores its own configuration in a pluggable backend:

- **File mode** (default) — INI file + blob directory on disk
- **Vault mode** — Vault KV v2 engine `vaultlens-conf`

See [Configuration](/guide/configuration) for details.

## Frontend State Management

| Store | Purpose |
|-------|---------|
| `authStore` | Authentication state, current user token info |
| `brandingStore` | Current branding config (app name, colors, logo) |
| `vaultStore` | Cached Vault metadata (engines, auth methods) |

Server state (secret lists, policy details, etc.) is managed by **TanStack Query** with automatic caching and background refetching.
