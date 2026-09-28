VaultLens — web UI for HashiCorp Vault (Express backend + React frontend), single npm workspace at `app/`.

Repo root layout:
- `app/` — the actual application (source of truth for everything below); repo root itself has no package.json.
- `docs/` — separate VitePress-style docs site with its own `package.json`; not part of the app build.
- `charts/vaultlens/` — Helm chart for k8s deployment.
- `vault/` — local dev Vault policies/scripts used for manual testing against a real Vault instance.
- `monitoring/` — Prometheus/Grafana config for the bundled monitoring stack.
- Docker: root `Dockerfile` + `docker-compose.yml` / `docker-compose-development.yml` build/run `app/`.

`app/src` is split into three trees with separate ESLint rule sets (browser vs node globals): `client/` (React), `server/` (Express), `shared/` (`authActions.ts`, `policyEvaluator.ts` — logic needed by both, e.g. Vault ACL policy evaluation must match on client and server).

See `mem:tech_stack`, `mem:suggested_commands`, `mem:conventions`, `mem:task_completion` for details. See `mem:server/core` for backend architecture (routes/lib/middleware) and Vault/K8s/AWS auth integration points.