# Getting Started

VaultLens is a standalone web UI for HashiCorp Vault. It runs as a lightweight Node.js/Express server that proxies requests to your Vault instance using the logged-in user's token.

::: tip Beta Notice
VaultLens is currently in **beta** and under active development. It has no affiliation with HashiCorp.
:::

## Prerequisites

- A running HashiCorp Vault instance (v1.12+)
- A Vault token with permissions to browse the resources you want to manage
- Docker (recommended) or Node.js 22+

## Quick Start with Docker

The fastest way to get VaultLens running:

```bash
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

## Quick Start with Docker Compose

```bash
export VAULT_ADDR=http://your-vault-server:8200
export VAULT_SYSTEM_TOKEN=your-system-token

docker compose up -d
```

The included `docker-compose.yml` creates two named volumes automatically:
- **`vaultlens_config`** — persists branding, webhooks, and rotation config
- **`vaultlens_backups`** — persists backup JSON files

## Logging In

![Login Page](/screenshots/login.png)

VaultLens supports two authentication methods:

- **Vault Token** — Paste any valid Vault token directly. The token is stored in an httpOnly cookie and never exposed to JavaScript.
- **OIDC** — If your Vault has an OIDC auth method configured, you can log in via a popup flow.

## The Dashboard

After logging in you'll land on the Dashboard:

![Dashboard](/screenshots/dashboard.png)

The Dashboard shows at a glance:
- **Secret Engines** — number of mounted KV engines
- **ACL Policies** — total policy count
- **Auth Methods** — number of enabled auth methods
- **Quick Navigation** — links to the most commonly used sections

## First-Time Setup Wizard

After logging in for the first time, VaultLens may show a **Configuration Issues** wizard. This detects missing policies or audit configuration and offers to fix them automatically.

- Click **Approve & Fix** to let VaultLens create the required policies (`vaultlens-admin`, `vaultlens-system`) and register the socket audit device
- Click **Skip for now** to proceed without background services

Once complete, the wizard prompts you to configure the **System Token** using AppRole auth — used by background services (rotation, backup, webhooks).

## Next Steps

- [Configuration Reference](/guide/configuration) — all environment variables
- [Deployment Options](/guide/deployment) — Docker, Compose, Helm
- [Secret Management](/features/secrets) — browsing and editing secrets
