# Local Development

## Prerequisites

- Node.js 22+
- Docker & Docker Compose

## Dashboard Preview

After completing setup you'll see the VaultLens dashboard:

![Dashboard](/screenshots/dashboard.png)

## 1. Start Vault

The repository includes a Docker Compose file that starts Vault in dev mode and runs a bootstrap script to seed it with test data:

```bash
docker compose -f docker-compose-development.yml up -d vault vault-init
```

This starts:
- **Vault** at http://localhost:8200 (dev token: `root`)
- **vault-init** — seeds KV engines, policies, auth methods, and example secrets

## 2. Start VaultLens

```bash
cd app
npm install
npm run dev
```

VaultLens starts at **http://localhost:3001**.

Default login token: `root`

## Environment

The `app/.env` file configures the development environment:

```bash
PORT=3001
NODE_ENV=development
VAULT_ADDR=http://127.0.0.1:8200
VAULT_SYSTEM_TOKEN=root
VAULT_SKIP_TLS_VERIFY=false
```

The full list of environment variables is in the [Configuration Reference](/guide/configuration).

## Project Structure

```
app/
  src/
    client/          # React SPA (Vite + TypeScript)
      components/    # UI components by domain
      lib/           # Axios client, OpenPGP helpers
      pages/         # 17 route-level page components
      stores/        # Zustand stores
      types/         # Shared TypeScript types
    server/          # Express API
      config/        # Environment configuration
      lib/           # Vault client, system token, config storage
      middleware/    # Auth, CSRF, error handler
      routes/        # 14 route modules
      types/         # Server-side types
    shared/          # Shared utilities (policy evaluator)
```

## Available Scripts

| Script | Description |
|--------|-------------|
| `npm run dev` | Start dev server with HMR (Vite + tsx watch) |
| `npm run build` | Build client (Vite) + server (tsc) |
| `npm start` | Serve production build |
| `npm run lint` | Run ESLint |

## Testing Checklist

After making changes, verify:

1. **Secrets page** — `identity/` and `system/` engines should NOT appear in the list
2. **Auth Methods** — GitHub → Roles tab shows empty table (no 404). Kubernetes → Configuration shows empty form (no 404)
3. **Breadcrumbs** — All segments (except the last) are clickable links
4. **Shared secrets** — Create a secret, copy the URL, open in incognito — it should decrypt
5. **Permission tester** — Select `demo-user` entity, path `test`, operation `create` → should show **denied**
6. **OIDC callback** — `/oidc-callback/:mountPath` must be accessible without auth
7. **Audit log** — `/admin/audit-log` shows recent operations
8. **Analytics** — `/admin/analytics` shows health data
