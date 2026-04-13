#!/bin/sh
set -e

echo "============================================"
echo "  VaultLens — Vault Bootstrap Script"
echo "============================================"

# ── Wait for Vault readiness ──────────────────────────────────────────────────
echo ""
echo "→ Waiting for Vault to be ready..."
until vault status > /dev/null 2>&1; do
  echo "  Vault not ready yet, retrying in 2s..."
  sleep 2
done
echo "✓ Vault is ready"

# ── Enable Audit Device (file-based) ──────────────────────────────────────────
echo ""
echo "→ Enabling file audit device..."
vault audit enable file file_path=/vault/audit/vault-audit.log hmac_accessor=false 2>/dev/null || echo "  (already enabled)"
echo "✓ File audit device enabled at /vault/audit/vault-audit.log (hmac_accessor=false)"

# ── Enable KV v2 secret engine ────────────────────────────────────────────────
echo ""
echo "→ Enabling KV v2 secrets engine at kv/..."
vault secrets enable -path=kv -version=2 kv 2>/dev/null || echo "  (already enabled)"
echo "✓ KV v2 engine enabled at kv/"

# ── Apply Policies ────────────────────────────────────────────────────────────
echo ""
echo "→ Applying policies..."

vault policy write admin /vault/policies/admin.hcl
echo "  ✓ admin policy applied"

vault policy write readonly /vault/policies/readonly.hcl
echo "  ✓ readonly policy applied"

vault policy write app-specific /vault/policies/app-specific.hcl
echo "  ✓ app-specific policy applied"

vault policy write vaultlens-admin /vault/policies/vaultlens-admin.hcl
echo "  ✓ vaultlens-admin policy applied"

# ── Seed example secrets ──────────────────────────────────────────────────────
echo ""
echo "→ Seeding example secrets..."

vault kv put kv/product/service/nprd/secret \
  database_url="postgresql://app:s3cret@db.nprd.internal:5432/appdb" \
  api_key="nprd-ak-f8a2b3c4d5e6f7a8b9c0" \
  jwt_secret="nprd-jwt-super-secret-key-12345"
echo "  ✓ kv/product/service/nprd/secret"

vault kv put kv/product/service/nprd/config \
  log_level="debug" \
  feature_flags="enable_new_ui,enable_metrics" \
  max_connections="50"
echo "  ✓ kv/product/service/nprd/config"

vault kv put kv/product/service/nprd/certificates \
  tls_cert="-----BEGIN CERTIFICATE-----\nMIIBxTCCAWugAwIBAgIJAJ...(example)\n-----END CERTIFICATE-----" \
  tls_key="-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBgkqhkiG...(example)\n-----END PRIVATE KEY-----"
echo "  ✓ kv/product/service/nprd/certificates"

vault kv put kv/product/service/prod/secret \
  database_url="postgresql://app:pr0d-s3cret@db.prod.internal:5432/appdb" \
  api_key="prod-ak-a1b2c3d4e5f6a7b8c9d0"
echo "  ✓ kv/product/service/prod/secret"

vault kv put kv/shared/team-credentials \
  ci_token="ghp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" \
  deploy_key="ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIExample"
echo "  ✓ kv/shared/team-credentials"

# Set rotation metadata on a secret for auto-rotation demo
vault kv metadata put -custom-metadata=rotate-interval=24h -custom-metadata=rotate-format="abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789" kv/product/service/nprd/secret 2>/dev/null || true
echo "  ✓ Rotation metadata set on kv/product/service/nprd/secret (24h interval)"

# ── Enable Kubernetes Auth ────────────────────────────────────────────────────
echo ""
echo "→ Enabling Kubernetes auth method..."
vault auth enable \
  -description="cluster=prod-east kubernetes_version=1.30 https://kubernetes.rancher.example.com" \
  kubernetes 2>/dev/null || echo "  (already enabled)"

# Configure with placeholder values for local development only.
# WARNING: disable_iss_validation and disable_local_ca_jwt are insecure
# and must NOT be used in production. Replace with real cluster values.
vault write auth/kubernetes/config \
  kubernetes_host="https://kubernetes.default.svc:443" \
  kubernetes_ca_cert="placeholder-ca-cert" \
  token_reviewer_jwt="placeholder-reviewer-jwt" \
  disable_iss_validation=true \
  disable_local_ca_jwt=true 2>/dev/null || true
echo "  ✓ Kubernetes auth configured (placeholder values)"

# Create example role bound to a service account and namespace
vault write auth/kubernetes/role/app-role \
  bound_service_account_names="app-service-account" \
  bound_service_account_namespaces="product-nprd" \
  policies="app-specific" \
  ttl="1h" \
  max_ttl="4h"
echo "  ✓ Kubernetes role 'app-role' created"

vault write auth/kubernetes/role/readonly-role \
  bound_service_account_names="monitoring-sa" \
  bound_service_account_namespaces="monitoring" \
  policies="readonly" \
  ttl="1h" \
  max_ttl="4h"
echo "  ✓ Kubernetes role 'readonly-role' created"

vault write auth/kubernetes/role/argo-deployer \
  bound_service_account_names="argo-workflow-sa" \
  bound_service_account_namespaces="argo" \
  policies="app-specific" \
  ttl="2h" \
  max_ttl="8h"
echo "  ✓ Kubernetes role 'argo-deployer' created"

# ── Enable GitHub Auth ────────────────────────────────────────────────────────
echo ""
echo "→ Enabling GitHub auth method..."
vault auth enable \
  -description="org=example-org env=prod https://github.com/example-org" \
  github 2>/dev/null || echo "  (already enabled)"

# Configure with organization
vault write auth/github/config \
  organization="example-org"
echo "  ✓ GitHub auth configured for organization 'example-org'"

# Map teams to policies
vault write auth/github/map/teams/engineering \
  value="admin"
echo "  ✓ GitHub team 'engineering' mapped to 'admin' policy"

vault write auth/github/map/teams/devops \
  value="admin,app-specific"
echo "  ✓ GitHub team 'devops' mapped to 'admin,app-specific' policies"

vault write auth/github/map/teams/readonly-users \
  value="readonly"
echo "  ✓ GitHub team 'readonly-users' mapped to 'readonly' policy"

# ── Create Identity Entities and Groups (for permission tester demo) ──────────
echo ""
echo "→ Creating identity entities and groups..."

# Create an example entity
ENTITY_ID=$(vault write -field=id identity/entity \
  name="demo-user" \
  policies="app-specific" \
  metadata=role="developer" 2>/dev/null || echo "")
echo "  ✓ Entity 'demo-user' created (ID: ${ENTITY_ID})"

# Create a group with the entity as a member
vault write identity/group \
  name="developers" \
  policies="readonly" \
  member_entity_ids="${ENTITY_ID}" \
  metadata=team="engineering" 2>/dev/null || true
echo "  ✓ Group 'developers' created with member 'demo-user'"

# ── Summary ───────────────────────────────────────────────────────────────────
echo ""
echo "============================================"
echo "  ✓ Vault bootstrap complete!"
echo "============================================"
echo ""
echo "  Vault Address:  http://localhost:8200"
echo "  Root Token:     root"
echo ""
echo "  KV Engine:      kv/ (v2)"
echo "  Auth Methods:   token, kubernetes (roles: app-role, readonly-role, argo-deployer), github"
echo "  Policies:       admin, readonly, app-specific, vaultlens-admin"
echo "  Audit:          file → /vault/audit/vault-audit.log"
echo ""
echo "  Example secrets seeded at:"
echo "    kv/product/service/nprd/secret"
echo "    kv/product/service/nprd/config"
echo "    kv/product/service/nprd/certificates"
echo "    kv/product/service/prod/secret"
echo "    kv/shared/team-credentials"
echo ""
echo "  Run VaultLens:"
echo "    cd app && npm run dev"
echo ""
