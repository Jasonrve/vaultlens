# Deployment

VaultLens supports three deployment methods:

| Method | Best For |
|--------|----------|
| **Docker Run** | Quick testing, single server |
| **Docker Compose** | Small/medium deployments |
| **Helm / Kubernetes** | Production K8s clusters |

## Docker Run

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

## Docker Compose

```bash
export VAULT_ADDR=http://your-vault-server:8200
export VAULT_SYSTEM_TOKEN=your-system-token

docker compose up -d
```

The included `docker-compose.yml` uses two named volumes:
- **`vaultlens_config`** → `/config` — branding, webhooks, rotation config
- **`vaultlens_backups`** → `/backups` — backup JSON files

## Kubernetes / Helm

```bash
helm install vaultlens ./charts/vaultlens \
  --set config.vaultAddr=http://vault:8200 \
  --set kubernetesAuth.enabled=true \
  --set kubernetesAuth.role=vaultlens \
  --set backup.persistence.enabled=true \
  --set configStorage.persistence.enabled=true
```

For stateless multi-replica deployments:

```bash
helm install vaultlens ./charts/vaultlens \
  --set config.vaultAddr=http://vault:8200 \
  --set kubernetesAuth.enabled=true \
  --set kubernetesAuth.role=vaultlens \
  --set configStorage.backend=vault
```

Setting `configStorage.backend=vault` stores all VaultLens configuration in a Vault KV v2 engine, eliminating the need for a persistent volume. This is the recommended approach for production K8s deployments.

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
