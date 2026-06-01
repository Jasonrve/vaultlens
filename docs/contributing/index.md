# Contributing to VaultLens

Thanks for your interest in contributing! VaultLens is an open-source project and welcomes contributions of all kinds — bug fixes, new features, documentation improvements, and feedback.

## Ways to Contribute

- **Bug reports** — open a [GitHub issue](https://github.com/Jasonrve/vaultlens/issues) with reproduction steps
- **Feature requests** — describe the use case in a GitHub issue before implementing
- **Code contributions** — fork the repo, make changes on a feature branch, and open a pull request
- **Documentation** — improvements to this site are always welcome

## Prerequisites

Before setting up the development environment you'll need:

- **Node.js 22+**
- **Docker & Docker Compose** — for running a local Vault instance
- **Git**

## Quick Start for Contributors

```bash
# 1. Fork and clone
git clone https://github.com/YOUR_USERNAME/vaultlens.git
cd vaultlens

# 2. Start a local Vault instance (dev mode, pre-seeded)
docker compose -f docker-compose-development.yml up -d vault vault-init

# 3. Install dependencies and start the dev server
cd app
npm install
npm run dev
```

Open **http://localhost:3001** and log in with token `root`.

See [Local Development](/contributing/local-development) for the full setup guide.

## Project Structure

```
app/
  src/
    client/       # React SPA (Vite + TypeScript)
    server/       # Express API + Vault proxy
    shared/       # Shared types/utilities (policyEvaluator.ts)
vault/
  policies/       # HCL ACL policies for bootstrapping
  scripts/        # bootstrap.sh seeds local Vault
charts/
  vaultlens/      # Helm chart for Kubernetes deployment
docs/             # This documentation site (VitePress)
```

## Development Workflow

1. Create a feature branch from `main`: `git checkout -b feature/my-change`
2. Make your changes — see [Local Development](/contributing/local-development) for dev server details
3. Run lint: `cd app && npm run lint`
4. Test the [checklist below](#testing-checklist) manually
5. Open a pull request against `main`

## Code Conventions

- **TypeScript** throughout — no `any` unless unavoidable
- **No `git commit`/`git push` from CI scripts** — leave that to the developer
- **`encodeURIComponent()`** on all user-supplied Vault paths passed to the API
- **`path.basename()`** on all file-system path parameters
- **Vault operations from route handlers use `req.vaultToken`** — never the system token for user-initiated requests
- **Webhook URLs must pass the SSRF blocklist** — no localhost, private ranges, metadata endpoints

## Security Guidelines

- System token is **never** returned in any API response or log
- Auth routes are mounted **before** CSRF middleware by design
- Error responses use generic messages only — no stack traces or internal detail
- All new `/api/` routes must use `authMiddleware` unless explicitly public

See [Security Architecture](/architecture/security) for the full security model.

## Testing Checklist

After making changes, verify these manually:

1. **Secrets page** — `identity/` and `system/` engines should NOT appear
2. **Auth Methods** — GitHub → Roles tab shows empty table (no 404)
3. **Breadcrumbs** — all segments except the last are clickable links
4. **Shared secrets** — create, copy URL, open in incognito — decrypts correctly
5. **Permission tester** — `demo-user`, path `test`, operation `create` → **denied**
6. **OIDC callback** — `/oidc-callback/:mountPath` accessible without auth
7. **View shared secret** — `/shared/:id#key` accessible without auth
8. **Backup/restore** — create backup, delete a secret, restore, secret reappears
9. **Webhooks** — create, test fires; SSRF-blocked URLs are rejected
10. **Analytics** — shows health data and counters
11. **Branding** — change app name/logo, header updates

## Commit Style

Use conventional commits:

```
feat: add webhook retry on failure
fix: handle 403 on KV list endpoint
docs: update configuration reference
chore: bump express to 4.21.2
```

## Shell Scripts

`vault/scripts/bootstrap.sh` must use **Unix line endings (LF)**. The `.gitattributes` file enforces this — do not change the line endings.
