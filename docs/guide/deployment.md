# Deployment

VaultLens supports three deployment methods:

| Method | Best For |
|--------|----------|
| **Docker Run** | Quick testing, single server |
| **Docker Compose** | Small/medium deployments |
| **Helm / Kubernetes** | Production K8s clusters |

## Docker Run

The minimal command — config is stored inside the container (suitable for testing):

```bash
docker run -d \
  --name vaultlens \
  -p 3001:3001 \
  -e VAULT_ADDR=http://your-vault-server:8200 \
  -e VAULT_SYSTEM_TOKEN=your-system-token \
  ghcr.io/jasonrve/vaultlens:latest
```

For persistent config and backups across restarts, add named volumes:

```bash
docker volume create vaultlens_config
docker volume create vaultlens_backups

docker run -d \
  --name vaultlens \
  -p 3001:3001 \
  -e VAULT_ADDR=http://your-vault-server:8200 \
  -e VAULT_SYSTEM_TOKEN=your-system-token \
  -e VAULTLENS_CONFIG_PATH=/config \
  -e VAULTLENS_BACKUP_PATH=/backups \
  -v vaultlens_config:/config \
  -v vaultlens_backups:/backups \
  ghcr.io/jasonrve/vaultlens:latest
```

## Docker Compose

Download just the compose file from the repository (no need to clone the whole repo):

```bash
curl -O https://raw.githubusercontent.com/Jasonrve/vaultlens/main/docker-compose.yml
export VAULT_ADDR=http://your-vault-server:8200
export VAULT_SYSTEM_TOKEN=your-system-token
docker compose up -d
```

The included `docker-compose.yml` uses two named volumes:
- **`vaultlens_config`** → `/config` — branding, webhooks, rotation config
- **`vaultlens_backups`** → `/backups` — backup JSON files

## Kubernetes / Helm

The Helm chart is distributed two ways — both require no repo clone.

### Via OCI (recommended)

The chart is published to the GitHub Container Registry as an OCI artifact:

```bash
helm install vaultlens oci://ghcr.io/jasonrve/charts/vaultlens \
  --set config.vaultAddr=http://vault:8200 \
  --set kubernetesAuth.enabled=true \
  --set kubernetesAuth.role=vaultlens \
  --set backup.persistence.enabled=true \
  --set configStorage.persistence.enabled=true
```

Pin to a specific version:

```bash
helm install vaultlens oci://ghcr.io/jasonrve/charts/vaultlens --version 0.6.0 \
  --set config.vaultAddr=http://vault:8200 \
  --set kubernetesAuth.enabled=true \
  --set kubernetesAuth.role=vaultlens
```

### Via GitHub Release tarball

Each release also attaches the chart tarball directly. Install by URL:

```bash
helm install vaultlens https://github.com/Jasonrve/vaultlens/releases/download/v0.6.0/vaultlens-0.6.0.tgz \
  --set config.vaultAddr=http://vault:8200 \
  --set kubernetesAuth.enabled=true \
  --set kubernetesAuth.role=vaultlens
```

See [charts/vaultlens/values.yaml](https://github.com/Jasonrve/vaultlens/blob/main/charts/vaultlens/values.yaml) for all configurable Helm parameters.

## VaultLens Vault Policies

VaultLens automatically creates two Vault policies at startup:

### `vaultlens-admin`

A thin UI-flag policy granting access to admin features in VaultLens (backup, branding, webhooks, analytics, audit log viewer). It has minimal Vault permissions and is intended for human administrators.

Assign this policy to any Vault user who should have access to VaultLens admin features.

### `vaultlens-system`

Full permissions for VaultLens background services. **Do not assign to human users.**

Used by the system token (AppRole or Kubernetes auth) for:
- Secret rotation scheduler
- Audit log watcher / webhook notifications  
- Backup scheduler
- Shared secrets cubbyhole
- Policy initialization

## TLS / Reverse Proxy

VaultLens does not handle TLS itself. For production, place it behind a reverse proxy (Nginx, Caddy, Traefik, etc.) that terminates TLS.

The `Strict-Transport-Security` (HSTS) header is automatically set when `NODE_ENV=production`.

## Upgrading

Pull the latest image and restart the container. VaultLens is stateless — all persistent data lives in the mounted volumes or Vault KV.

```bash
docker pull ghcr.io/Jasonrve/vaultlens:latest
docker compose up -d
```
