# VaultLens Prometheus Metrics & Observability Tasks

## Status Legend
- [ ] Not started
- [~] In progress
- [x] Done

---

## T1 — Install prom-client dependency
- [ ] T1.1 Add `prom-client` npm package to app/package.json

## T2 — Prometheus metrics module
- [ ] T2.1 Create `app/src/server/lib/metrics.ts` — central registry, define all metrics:
  - `http_requests_total` (counter: method, route, status_code)
  - `http_request_duration_seconds` (histogram: method, route, status_code)
  - `vault_api_calls_total` (counter: method, path, status)
  - `vault_api_call_duration_seconds` (histogram: method, path)
  - `vaultlens_auth_logins_total` (counter: method [token|oidc], result [success|failure])
  - `vaultlens_secrets_operations_total` (counter: operation [read|write|delete|list])
  - `vaultlens_shared_secrets_created_total` (counter)
  - `vaultlens_shared_secrets_retrieved_total` (counter)
  - `vaultlens_backups_total` (counter: result [success|failure])
  - `vaultlens_rotation_runs_total` (counter: result [success|failure])
  - `vaultlens_webhook_fires_total` (counter: result [success|failure])
  - `vaultlens_active_sessions` (gauge — increment on login, decrement on logout)
  - `process_` metrics — use prom-client default metrics

## T3 — HTTP incoming request middleware
- [ ] T3.1 Create `app/src/server/middleware/metrics.ts` — Express middleware that:
  - Records `http_requests_total`
  - Records `http_request_duration_seconds` using response-finish hook
  - Normalises route labels (avoid high cardinality from path params)

## T4 — Instrument Vault client (outgoing calls)
- [ ] T4.1 Modify `app/src/server/lib/vaultClient.ts` — wrap `request()` method to:
  - Increment `vault_api_calls_total` with status
  - Observe `vault_api_call_duration_seconds`

## T5 — Expose /metrics endpoint
- [ ] T5.1 Add `GET /metrics` route in `app/src/server/app.ts` — public, no auth, no CSRF
  - Uses `register.metrics()` from prom-client
  - Content-type: `text/plain; version=0.0.4`

## T6 — Instrument application events
- [ ] T6.1 auth.ts login — increment `vaultlens_auth_logins_total`
- [ ] T6.2 auth.ts logout — decrement `vaultlens_active_sessions`
- [ ] T6.3 secrets.ts read/write/delete/list — increment `vaultlens_secrets_operations_total`
- [ ] T6.4 sharing.ts create/retrieve — increment `vaultlens_shared_secrets_*`
- [ ] T6.5 backup.ts — increment `vaultlens_backups_total`
- [ ] T6.6 rotation.ts scheduler — increment `vaultlens_rotation_runs_total`
- [ ] T6.7 hooks.ts webhook fires — increment `vaultlens_webhook_fires_total`

## T7 — Docker Compose: add Prometheus + Grafana
- [ ] T7.1 Add `prometheus` service to `docker-compose-development.yml`
- [ ] T7.2 Add `grafana` service to `docker-compose-development.yml`
- [ ] T7.3 Create `monitoring/prometheus.yml` — scrape configs for VaultLens and Vault
- [ ] T7.4 Create `monitoring/grafana/provisioning/datasources/prometheus.yml`
- [ ] T7.5 Create `monitoring/grafana/provisioning/dashboards/dashboard.yml`
- [ ] T7.6 Create `monitoring/grafana/dashboards/vaultlens-app.json` — app dashboard
- [ ] T7.7 Create `monitoring/grafana/dashboards/vault-server.json` — Vault server dashboard

## T8 — VS Code launch config
- [ ] T8.1 Add "Debug App + Monitoring (Remote Vault)" config to `.vscode/launch.json`
  - Uses root `.env` for Vault addr
  - Also starts `docker-compose` with only prometheus+grafana services

## T9 — Vault telemetry (for vault dashboard)
- [ ] T9.1 Update `docker-compose-development.yml` vault service to enable telemetry config so Prometheus can scrape Vault's own /v1/sys/metrics endpoint

## T10 — Validate everything
- [ ] T10.1 Verify /metrics endpoint is reachable
- [ ] T10.2 Verify Prometheus scrapes VaultLens successfully
- [ ] T10.3 Verify Grafana loads dashboards
- [ ] T10.4 Check all metric labels are correct

---
Generated: 2026-04-17
