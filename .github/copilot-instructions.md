# VaultLens — GitHub Copilot Instructions

## Project Overview

VaultLens is a full-stack HashiCorp Vault management UI built with React + Vite (frontend) and Node.js/Express (backend), served as a single unified runtime from the `app/` folder.

**Key capabilities:**
- Browse and edit KV v1/v2 secrets across all mounted engines
- Manage ACL policies, auth methods (OIDC, GitHub, Kubernetes, AppRole, ...), and identity entities/groups
- Visualise relationships between auth methods, policies, secrets, and identities using React Flow graphs
- Permission tester — show what a specific entity can do on any path
- End-to-end encrypted password sharing via URL fragment (OpenPGP, server never sees plaintext)
- Custom branding (app name, logo, primary colour) via pluggable config storage
- OIDC login via popup flow
- Secret auto-rotation with background scheduler
- Full backup/restore of all KV secrets (manual + scheduled)
- Webhook notifications on secret changes (audit log monitoring)
- Analytics dashboard (health, seal status, counters)
- Audit log viewer with resource links

---

## Technology Stack

| Layer | Technology | Version |
|-------|-----------|---------|
| Runtime | Node.js | 22 |
| Backend | Express | 4.21.2 |
| Frontend | React | 19.2.4 |
| Build | Vite | 8.0.3 |
| Language | TypeScript | 5.7.3 |
| Styling | TailwindCSS | 4.2.2 |
| State | Zustand | 5.0.12 |
| Server State | @tanstack/react-query | 5.95.2 |
| Routing | react-router-dom | 7.13.2 |
| Graphs | @xyflow/react | 12.10.1 |
| Encryption | OpenPGP.js | 6.1.1 |
| HTTP Client | axios | 1.13.6 |
| Security | Helmet 8.0.0, express-rate-limit 7.5.0, hpp 0.2.3 |

---

## Repository Layout

```
app/                         # Unified frontend + backend application
  src/
    client/                  # React SPA (Vite)
      components/            # UI components by domain
        auth/                # LoginPage
        auth-methods/        # AuthMethodList, Detail, Config, Tune, RoleList, RoleDetail
        common/              # Badge, Breadcrumb, ErrorMessage, JsonEditor, LoadingSpinner, Modal, Table
        graphs/              # AuthPolicyGraph, PolicySecretGraph, IdentityGraph, GraphWrapper, GraphTableView
        identity/            # EntityList, EntityDetail, GroupList, GroupDetail
        layout/              # Layout, Header, Sidebar
        policies/            # PolicyList, PolicyDetail, PolicyStructure
        secrets/             # SecretsEngineList, SecretsList, SecretView, SecretEditor, SecretMergeEditor
      lib/                   # api.ts (Axios client), crypto.ts (OpenPGP helpers)
      pages/                 # 17 route-level page components (see Page Map below)
      stores/                # authStore, brandingStore, vaultStore (Zustand)
      types/                 # Shared TypeScript types
    server/                  # Express API
      config/index.ts        # Environment configuration (reads .env)
      lib/
        vaultClient.ts       # Vault HTTP API wrapper (get/post/put/delete/list)
        systemToken.ts       # System token resolution (K8s auth / static token)
        policyInit.ts        # Auto-creates vaultlens-admin policy on startup
        config-storage/      # Pluggable config backend
          types.ts           # ConfigStorageProvider interface
          index.ts           # Singleton factory (getConfigStorage)
          fileStorage.ts     # INI file + blob storage on disk
          vaultStorage.ts    # Vault KV v2 engine backend
      middleware/            # auth.ts, csrf.ts, errorHandler.ts, requireAdmin.ts
      routes/                # 14 route modules (see Backend Routes below)
      types/index.ts         # Server-side types (AuthenticatedRequest, GraphNode, ...)
  data/                      # Runtime data (file-mode config storage, NOT committed)
    branding.json            # Branding config (file mode)
    backups/                 # Backup JSON files
    blobs/                   # Logo and binary uploads
  package.json               # Scripts: dev | build | start | lint
  tsconfig.json
  .env                       # Local environment config (not committed)
vault/
  policies/                  # HCL ACL policies (admin, readonly, app-specific, vaultlens-admin)
  scripts/bootstrap.sh       # Seeds Vault for local development
charts/
  vaultlens/                 # Helm chart for Kubernetes deployment
docker-compose.yml           # Production: Vault + vault-init (runs bootstrap.sh)
docker-compose-development.yml # Dev: mounts local vault/ directory
docs/                        # Architecture, API reference, security, audit reports
.github/                     # Copilot instructions (this file)
```

---

## Backend Routes (`app/src/server/routes/`)

| File | Mount | Auth | Admin | Description |
|------|-------|------|-------|-------------|
| `auth.ts` | `/api/auth` | — | — | Login, logout, session check, OIDC flow |
| `branding.ts` | `/api/branding` | Mixed | PUT/POST/DELETE | App name, logo, primary colour (via config storage) |
| `sharing.ts` | `/api/sharing` | Mixed | — | Create/retrieve/delete encrypted shared secrets |
| `secrets.ts` | `/api/secrets` | Yes | — | CRUD on KV secrets; secure merge; path validation |
| `policies.ts` | `/api/policies` | Yes | — | List/read/parse ACL policies |
| `authMethods.ts` | `/api/auth-methods` | Yes | — | List/configure auth methods, roles, tune |
| `identity.ts` | `/api/identity` | Yes | — | Entities, groups, entity suggestions |
| `graph.ts` | `/api/graph` | Yes | — | React Flow graph data (auth->policy, policy->secret, identity) |
| `permissions.ts` | `/api/permissions` | Yes | — | Capability testing and entity permission graph |
| `audit.ts` | `/api/audit` | Yes | Devices | Audit log viewer, audit device management |
| `sys.ts` | `/api/sys` | Yes | — | Health, seal status, leader, host info |
| `rotation.ts` | `/api/rotation` | Yes | — | Secret rotation config and manual rotation trigger |
| `backup.ts` | `/api/backup` | Yes | Yes | Backup/restore and scheduled backup config |
| `hooks.ts` | `/api/hooks` | Yes | Yes | Webhook CRUD, test, and audit event matching |

---

## Middleware Stack (in order, numbered in `app.ts`)

| # | Middleware | Purpose |
|---|-----------|---------|
| 1 | Request ID | `crypto.randomUUID()` per request for log correlation |
| 2 | Permissions-Policy | Denies all browser features (`camera=(), microphone=(), geolocation=()`) |
| 3 | Helmet | CSP, HSTS, X-Frame-Options, Referrer-Policy (strict in prod, relaxed in dev) |
| 4 | CORS | Only active when `CORS_ORIGIN` is set |
| 5 | Morgan | HTTP request logging with request ID |
| 6 | Cookie Parser | Parses `vault_token` and `csrf_token` cookies |
| 7 | JSON Body Parser | 1MB limit |
| 8 | Rate Limiter | Global limit on `/api/*` only |
| 9 | HPP | HTTP parameter pollution protection |
| 10 | Health Check | `GET /api/health` (always public) |
| 11 | Auth Routes | Mounted **before** CSRF (login/logout don't require CSRF token) |
| 12 | CSRF | Double-submit cookie pattern on all subsequent routes |
| 13 | Branding + Sharing | Mixed public/protected (GET branding public, mutations need auth + CSRF) |
| 14 | Protected Routes | All remaining `/api/*` routes |
| 15 | Error Handler | Centralised — generic messages, no stack traces |

---

## Key Conventions

### Authentication
- Every authenticated route uses `authMiddleware` from `middleware/auth.ts`.
- The middleware validates the token via Vault's `/auth/token/lookup-self` and attaches `req.vaultToken` and `req.tokenInfo`.
- Token is sent via `vault_token` httpOnly cookie or `Authorization: Bearer` header.
- Public routes (no auth): `GET /api/sharing/:id`, `GET /api/branding`, `GET /api/health`, `/oidc-callback/:mountPath`, `/shared/:id`.

### Admin Authorization
- `requireAdmin` middleware (from `middleware/requireAdmin.ts`) checks for `root` policy or `vaultlens-admin` policy.
- Applied to: branding mutations, backup, hooks, audit device management.

### System Token
- `getSystemToken()` (from `lib/systemToken.ts`) is a **server-only** Vault token used exclusively for:
  - **Secure merge** — reading the existing secret so the server can merge user-supplied keys without exposing values the user cannot already read
  - Background services that run without an active user session: rotation scheduler, audit log watcher, backup scheduler
  - Shared secrets cubbyhole context (all users share one cubbyhole via the system token)
  - Policy initialization on startup
- **The system token is NOT used for browsing secrets, listing engines, reading/writing secrets outside of merge, or any other operation the user initiates.** All user-initiated API calls use the logged-in user's session token (`req.vaultToken`) so Vault's own ACL policies control access.
- **Resolution order**: (1) Kubernetes auth via `VAULT_K8S_AUTH_ROLE` + service account JWT (cached with 75% TTL auto-renewal), (2) static `VAULT_SYSTEM_TOKEN` env var
- **Never send or log this token in any response.**

### Vault Client
```typescript
// app/src/server/lib/vaultClient.ts
vaultClient.get<T>(path, token)
vaultClient.post<T>(path, token, body)
vaultClient.put<T>(path, token, body)
vaultClient.delete(path, token)
vaultClient.list<T>(path, token)  // Uses Vault LIST HTTP method
```
Throws `VaultError` (with `.statusCode`) on non-2xx responses. Always catch `VaultError` to handle Vault-specific errors (404, 403, etc.) before calling `next(error)`.

### Config Storage
- Pluggable backend for VaultLens's own configuration (branding, webhooks, rotation, backup schedules).
- **Interface**: `ConfigStorageProvider` with `get/set/delete/list` + `getBlob/setBlob/deleteBlob`.
- **Two backends**: `file` (INI on disk, default) and `vault` (Vault KV v2 engine `vaultlens-conf`).
- **Singleton**: `getConfigStorage()` returns the configured backend instance.
- Use `VAULTLENS_CONFIG_STORAGE=vault` for Kubernetes/production deployments.

### Frontend API Client
```typescript
// app/src/client/lib/api.ts
// Centralised Axios instance with baseURL='/api' and withCredentials:true
// Request interceptor: attaches X-CSRF-Token header
// Response interceptor: auto-redirects to /login on 401
```

### Shared Secrets / Crypto
- Encryption/decryption is done entirely in the browser using `app/src/client/lib/crypto.ts`.
- The decryption key is in the URL fragment (`#key`) and is never transmitted to the server.
- Use `encryptSecret(plaintext)` -> `{ encrypted, key }` and `decryptSecret(encrypted, key)`.
- **Protections**: 100KB payload limit, max 1000 stored secrets, batched cleanup (50/run), 20/min rate limit on public GET.

### Graph Data
- Graph routes return `{ nodes: GraphNode[], edges: GraphEdge[] }` for `@xyflow/react`.
- Node types: `entity`, `group`, `policy`, `secretPath`, `result`, `authMethod`, `role`.
- Nodes have a `status` field: `'success' | 'failure' | 'neutral'`.

### Permission Testing (Important)
- When `entityId` is provided to `POST /api/permissions/test-entity`, the `operationAllowed` result is computed from the entity's **parsed policies**, not from `/sys/capabilities-self`.
- `/sys/capabilities-self` reflects the LOGGED-IN user's token — do not use it for entity simulation.

---

## Background Services

Three services start at server boot (only when system token is available):

| Service | Entry Point | Interval | Purpose |
|---------|-------------|----------|---------|
| Rotation Scheduler | `startRotationScheduler()` in `rotation.ts` | 60s | Checks `custom_metadata.rotate-interval` on secrets, generates new passwords using rejection sampling |
| Audit Watcher | `startAuditWatcher()` in `hooks.ts` | 5s | Polls Vault audit log, matches events to webhook path patterns, fires HTTP POST with HMAC |
| Backup Scheduler | `startBackupScheduler()` in `backup.ts` | Configurable | Creates full KV backup at configured interval (`Nd`/`Nh`/`Nm`/`Nw` format) |

**Policy Init:** `ensureVaultLensAdminPolicy()` runs once at startup to create the `vaultlens-admin` policy in Vault if it doesn't exist.

---

## Frontend Page Map

### Public Routes (no auth)
| Route | Page | Purpose |
|-------|------|---------|
| `/login` | LoginPage | Token + OIDC login |
| `/oidc-callback/:mountPath` | OidcCallbackPage | OIDC popup callback |
| `/shared/:id` | ViewSharedSecretPage | Decrypt shared secret |

### Protected Routes (within `<Layout>`)
| Route | Page | Purpose |
|-------|------|---------|
| `/` | DashboardPage | Overview with engine/policy/auth counts |
| `/secrets/*` | SecretsPage | KV secret browsing, view, edit, merge |
| `/policies/*` | PoliciesPage | ACL policy list and detail |
| `/access/auth-methods/*` | AuthMethodsPage | Auth method -> config -> role management |
| `/access/entities/*` | IdentityPage | Entity list and detail |
| `/access/groups/*` | IdentityPage | Group list and detail |
| `/visualizations` | VisualizationsPage | React Flow graph tabs |
| `/identity` | MyIdentityPage | Current user's identity graph |
| `/admin/branding` | AdminBrandingPage | App name, logo, colour config |
| `/admin/permission-tester` | PermissionTesterPage | Entity permission simulation |
| `/admin/audit-log` | AuditLogPage | Audit log viewer with resource links |
| `/admin/analytics` | AnalyticsPage | Health, seal status, counters |
| `/admin/rotation` | SecretRotationPage | Rotation config and manual trigger |
| `/admin/backup` | BackupRestorePage | Backup/restore and schedule config |
| `/admin/hooks` | HooksPage | Webhook CRUD and testing |
| `/tools/share` | ShareSecretPage | Create encrypted shared secret |

---

## Running Locally

```bash
# 1. Start Vault and seed it
docker compose up -d

# 2. Start the application in development mode
cd app
npm install
npm run dev
```

- App: http://localhost:3001
- Vault UI: http://localhost:8200 (token: `root`)
- Default login token for VaultLens: `root`

### Environment Variables (`app/.env`)

```env
PORT=3001
NODE_ENV=development
VAULT_ADDR=http://127.0.0.1:8200
VAULT_SYSTEM_TOKEN=root
VAULT_SKIP_TLS_VERIFY=false

# Kubernetes auth — only VAULT_K8S_AUTH_ROLE is required; the others default:
# VAULT_K8S_AUTH_ROLE=vaultlens
# VAULT_K8S_AUTH_MOUNT=kubernetes
# VAULT_K8S_TOKEN_PATH=/var/run/secrets/kubernetes.io/serviceaccount/token

# Rate limiting (all /api/* routes):
# RATE_LIMIT_MAX=500              (default)
# RATE_LIMIT_WINDOW_MS=900000     (default 15 min)
# SHARING_RATE_LIMIT_MAX=20       (default, per-minute for public share endpoint)

# Config storage backend:
# VAULTLENS_CONFIG_STORAGE=file   (default; use 'vault' for production/K8s)
# VAULTLENS_CONFIG_PATH=./data    (default; path to config.ini and blobs/)
# VAULTLENS_BACKUP_PATH=./data/backups  (default; path to backup JSON files)

# Audit log:
# VAULT_AUDIT_LOG_PATH=./vault/audit/vault_audit.log

# CORS (only set if frontend is on a different origin):
# CORS_ORIGIN=http://localhost:5173
```

### Building for Production

```bash
cd app
npm run build   # builds client into dist/client/ and server into dist/server/
npm start       # serves everything from dist/
```

---

## Security Summary

### Protections
- **Per-request token validation** against Vault on every authenticated request
- **CSRF** double-submit cookie on all state-changing routes
- **Rate limiting** on all `/api/*` routes + stricter per-minute limit on public sharing
- **Helmet** with strict CSP in production (HSTS, X-Frame-Options, Referrer-Policy)
- **Input validation** on secrets (path traversal, data shape), auth configs, webhook URLs, backup filenames, rotation intervals
- **SSRF blocklist** on webhook endpoints (loopback, private, metadata ranges)
- **E2E encryption** for shared secrets (OpenPGP, key in URL fragment)
- **Error sanitisation** — generic messages only, no stack traces or internal details
- **Non-root Docker** container (UID 1001)
- **UUID format validation** on all parameterised webhook endpoints

### Security-Critical Rules
1. **System token** is NEVER returned in any API response or logged
2. **Auth routes** are mounted BEFORE CSRF middleware (by design — login creates new sessions)
3. **`encodeURIComponent()`** must be used on all user-provided Vault paths
4. **`path.basename()`** must be used on all file-system path parameters
5. **Webhook URLs** must be validated against the SSRF blocklist (no localhost, private, metadata)
6. **Backup restore** JSON must be structurally validated before processing

---

## Shell Scripts

`vault/scripts/bootstrap.sh` must use **Unix line endings (LF)** — not CRLF. The `.gitattributes` file enforces this:
```
*.sh text eol=lf
docker-compose* text eol=lf
```

---

## Testing Checklist (after changes)

1. **Secrets page** — `identity/` and `system/` engines should NOT appear in the list.
2. **Auth Methods** — Opening GitHub -> Roles tab should show empty table (no 404 error). Kubernetes -> Configuration should show empty form (no 404 error).
3. **Breadcrumbs** — All segments in the header breadcrumb (except the last) should be clickable links.
4. **Shared secrets** — Create a secret, copy the URL, open in a new tab (or incognito). The secret should decrypt successfully.
5. **Permission tester** — Select `demo-user` entity, enter path `test`, operation `create`. Should show **denied** (not allowed).
6. **OIDC callback** — `/oidc-callback/:mountPath` must be accessible without auth.
7. **View shared secret** — `/shared/:id#key` must be accessible without auth.
8. **Secret rotation** — Add rotation interval to a secret, verify the rotation scheduler picks it up.
9. **Backup/restore** — Create a backup, delete a secret, restore the backup, verify the secret reappears.
10. **Webhooks** — Create a webhook, use the test button, verify it fires. Verify SSRF-blocked URLs are rejected.
11. **Analytics** — `/admin/analytics` should show health data and counters.
12. **Audit log** — `/admin/audit-log` should show recent Vault operations.
13. **Branding** — Change app name and logo in `/admin/branding`, verify the header updates.
14. **Admin-only pages** — Backup, hooks pages should require `root` or `vaultlens-admin` policy.
