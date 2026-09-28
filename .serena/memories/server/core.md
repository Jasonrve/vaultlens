Backend entry: `server.ts` (bootstrap) → `app.ts` (Express app, CORS/helmet/CSP/rate-limit/morgan wiring, `/api/health`, `/metrics`).

`src/server/routes/*.ts` — one file per API area (secrets, auth, authMethods, authActions, policies, permissions, identity, graph, backup, rotation, sharing, audit, vaultlens-audit, hooks, branding, sys, sys-token-setup). Route file name is a reliable index into feature area — check there first before grepping.

`src/server/lib/*.ts` — core integration logic, notably:
- `vaultClient.ts` — direct HTTP calls to Vault API (no Vault SDK).
- `systemToken.ts` — the backend's own privileged Vault token, used for the "restricted-access partial update" flow (read with system token, write with user's token) described in the README.
- `kubernetesClient.ts` + `eksAuth.ts` — Kubernetes/EKS auth mount support, including hand-rolled SigV4 presigned-URL token building for EKS IAM auth (region auto-detection, per-mount env var resolution via `envNamesForMount`).
- `configEncryption.ts` / `config-storage/` — at-rest encryption for stored Vault connection config.
- `auditEvents.ts`, `auditSocket.ts`, `auditErrorAttribution.ts`, `vaultlensAudit.ts` — VaultLens's own audit trail (distinct from Vault's own audit devices) and live audit streaming.
- `policyLoader.ts` — loads/parses Vault ACL policies (pairs with `mem:core`'s `shared/policyEvaluator.ts` for evaluation).

`src/server/middleware/` — `auth.ts` (session/token auth), `csrf.ts`, `requireAdmin.ts`, `errorHandler.ts`, `metricsMiddleware.ts` (feeds `prom-client` `/metrics`).

For anything involving EKS/K8s auth or SigV4 token signing, see the self-check convention in `mem:conventions` — `eksAuth.selfcheck.ts` documents the exact token format expected by EKS's authenticator webhook.