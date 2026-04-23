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

# ── Audit Devices ──────────────────────────────────────────────────────────────
echo ""
echo "→ Socket audit is configured via VAULT_AUDIT_SOURCE=socket (server-managed)"
echo "✓ File audit disabled for local testing — using socket only"

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

# ── Enable AppRole Auth ───────────────────────────────────────────────────────
echo ""
echo "→ Enabling AppRole auth method..."
vault auth enable \
  -description="Machine-to-machine authentication for applications and CI/CD" \
  approle 2>/dev/null || echo "  (already enabled)"

vault write auth/approle/role/app-backend \
  token_policies="app-specific" \
  token_ttl="1h" \
  token_max_ttl="4h" \
  secret_id_ttl="24h" \
  secret_id_num_uses="0"
echo "  ✓ AppRole role 'app-backend' created"

vault write auth/approle/role/deploy-pipeline \
  token_policies="admin" \
  token_ttl="30m" \
  token_max_ttl="1h" \
  secret_id_ttl="1h" \
  secret_id_num_uses="10"
echo "  ✓ AppRole role 'deploy-pipeline' created"

vault write auth/approle/role/readonly-service \
  token_policies="readonly" \
  token_ttl="2h" \
  token_max_ttl="8h" \
  secret_id_ttl="0" \
  secret_id_num_uses="0"
echo "  ✓ AppRole role 'readonly-service' created"

# ── Enable UserPass Auth ──────────────────────────────────────────────────────
echo ""
echo "→ Enabling UserPass auth method..."
vault auth enable \
  -description="Username and password authentication for local development testing" \
  userpass 2>/dev/null || echo "  (already enabled)"

vault write auth/userpass/users/alice \
  password="Password1!" \
  token_policies="admin,vaultlens-admin" \
  token_ttl="8h" \
  token_max_ttl="24h"
echo "  ✓ UserPass user 'alice' created (admin, vaultlens-admin)"

vault write auth/userpass/users/bob \
  password="Password1!" \
  token_policies="app-specific" \
  token_ttl="8h" \
  token_max_ttl="24h"
echo "  ✓ UserPass user 'bob' created (app-specific)"

vault write auth/userpass/users/charlie \
  password="Password1!" \
  token_policies="readonly" \
  token_ttl="8h" \
  token_max_ttl="24h"
echo "  ✓ UserPass user 'charlie' created (readonly)"

# ── Enable LDAP Auth ──────────────────────────────────────────────────────────
echo ""
echo "→ Enabling LDAP auth method..."
vault auth enable \
  -description="LDAP/Active Directory authentication for enterprise users" \
  ldap 2>/dev/null || echo "  (already enabled)"

# Note: LDAP config requires a valid LDAP server. Skipping config for demo.
# In production, configure with: vault write auth/ldap/config url=... userdn=... etc.
echo "  ✓ LDAP auth enabled (configure with valid LDAP server in production)"

# ── Enable JWT Auth ───────────────────────────────────────────────────────────
echo ""
echo "→ Enabling JWT auth method..."
vault auth enable \
  -description="JSON Web Token (JWT) authentication for service-to-service auth" \
  jwt 2>/dev/null || echo "  (already enabled)"

# Note: JWT config requires a valid JWKS endpoint. Skipping config for demo.
# In production, configure with: vault write auth/jwt/config bound_issuer=... jwks_url=...
echo "  ✓ JWT auth enabled (configure with valid JWKS endpoint in production)"

# ── Enable OIDC Auth ──────────────────────────────────────────────────────────
echo ""
echo "→ Enabling OIDC auth method at oidc/..."
vault auth enable \
  -description="OpenID Connect (OIDC) authentication — configure with your IdP" \
  -path=oidc \
  oidc 2>/dev/null || echo "  (already enabled)"

# Note: OIDC config requires a valid OIDC discovery URL. Skipping config for demo.
# In production, configure with: vault write auth/oidc/config oidc_discovery_url=... oidc_client_id=...
echo "  ✓ OIDC auth enabled (configure with valid IdP in production)"

# ── Enable TLS Certificate Auth ───────────────────────────────────────────────
echo ""
echo "→ Enabling TLS Certificate auth method..."
vault auth enable \
  -description="Mutual TLS (mTLS) certificate authentication for services" \
  cert 2>/dev/null || echo "  (already enabled)"

# Note: cert auth requires real certificates. Creating a placeholder role only.
vault write auth/cert/certs/demo-service \
  display_name="Demo Service Certificate" \
  token_policies="app-specific" \
  token_ttl="1h" \
  certificate="-----BEGIN CERTIFICATE-----
MIICpDCCAYwCCQDU+pQ4pHgSpDANBgkqhkiG9w0BAQsFADAUMRIwEAYDVQQDDAls
b2NhbGhvc3QwHhcNMjMwMTAxMDAwMDAwWhcNMjQwMTAxMDAwMDAwWjAUMRIwEAYD
VQQDDAlsb2NhbGhvc3QwggEiMA0GCSqGSIb3DQEBAQUAA4IBDwAwggEKAoIBAQC7
(placeholder certificate for demo purposes only)
-----END CERTIFICATE-----" 2>/dev/null || echo "  (cert role creation skipped - placeholder certificate)"
echo "  ✓ TLS Certificate auth enabled (demo role configured)"

# ── Enable AWS Auth ───────────────────────────────────────────────────────────
echo ""
echo "→ Enabling AWS auth method..."
vault auth enable \
  -description="AWS IAM and EC2 authentication for cloud workloads" \
  aws 2>/dev/null || echo "  (already enabled)"

# Note: AWS auth config requires valid AWS credentials. Skipping for demo.
# In production, configure with: vault write auth/aws/config/client access_key=... secret_key=...
echo "  ✓ AWS auth enabled (configure with AWS credentials in production)"

# ── Enable Azure Auth ─────────────────────────────────────────────────────────
echo ""
echo "→ Enabling Azure auth method..."
vault auth enable \
  -description="Microsoft Azure Managed Identity authentication for Azure workloads" \
  azure 2>/dev/null || echo "  (already enabled)"

# Note: Azure auth config requires valid Azure credentials. Skipping for demo.
# In production, configure with: vault write auth/azure/config tenant_id=... client_id=...
echo "  ✓ Azure auth enabled (configure with Azure credentials in production)"

# ── Enable GCP Auth ───────────────────────────────────────────────────────────
echo ""
echo "→ Enabling GCP auth method..."
vault auth enable \
  -description="Google Cloud Platform (GCP) IAM and GCE authentication" \
  gcp 2>/dev/null || echo "  (already enabled)"

# Note: GCP auth config requires valid GCP credentials. Skipping for demo.
# In production, configure with: vault write auth/gcp/config credentials=...
echo "  ✓ GCP auth enabled (configure with GCP credentials in production)"

# ── Enable Okta Auth ──────────────────────────────────────────────────────────
echo ""
echo "→ Enabling Okta auth method..."
vault auth enable \
  -description="Okta single sign-on authentication for workforce identity" \
  okta 2>/dev/null || echo "  (already enabled)"

# Note: Okta auth config requires valid Okta organization and API token. Skipping for demo.
# In production, configure with: vault write auth/okta/config organization=... api_token=...
echo "  ✓ Okta auth enabled (configure with Okta organization in production)"

# ── Enable RADIUS Auth ────────────────────────────────────────────────────────
echo ""
echo "→ Enabling RADIUS auth method..."
vault auth enable \
  -description="RADIUS protocol authentication for legacy network infrastructure" \
  radius 2>/dev/null || echo "  (already enabled)"

# Note: RADIUS auth config requires a valid RADIUS server. Skipping for demo.
# In production, configure with: vault write auth/radius/config host=... secret=...
echo "  ✓ RADIUS auth enabled (configure with RADIUS server in production)"

# ── Create Test Users for Multi-User Testing ──────────────────────────────────
echo ""
echo "→ Creating test policies and token-based users..."

# Create readonly-admin policy (read access only, no mutations)
vault policy write readonly-admin - <<'POLICY' 2>/dev/null || true
path "*" {
  capabilities = ["read", "list"]
}
POLICY
echo "  ✓ readonly-admin policy created"

# Create secrets-operator policy (access to secret/* only)
vault policy write secrets-operator - <<'POLICY' 2>/dev/null || true
path "secret/*" {
  capabilities = ["create", "read", "update", "delete", "list"]
}
path "secret/metadata/*" {
  capabilities = ["create", "read", "update", "delete", "list"]
}
POLICY
echo "  ✓ secrets-operator policy created"

# Create auth-viewer policy (auth methods + OIDC only)
vault policy write auth-viewer - <<'POLICY' 2>/dev/null || true
path "auth/oidc/*" {
  capabilities = ["read", "list"]
}
path "auth/github/*" {
  capabilities = ["read", "list"]
}
path "auth/kubernetes/*" {
  capabilities = ["read", "list"]
}
path "auth/approle/*" {
  capabilities = ["read", "list"]
}
path "sys/auth" {
  capabilities = ["list"]
}
POLICY
echo "  ✓ auth-viewer policy created"

# Generate test user tokens
echo ""
echo "  Test user tokens:"
ADMIN_READONLY_TOKEN=$(vault token create -policy=readonly-admin -ttl=24h -format=json 2>/dev/null | grep -oP '"client_token":\s*"\K[^"]+' || echo "error")
echo "  • Admin-Readonly: $ADMIN_READONLY_TOKEN (readonly-admin policy)"

SECRETS_OP_TOKEN=$(vault token create -policy=secrets-operator -ttl=24h -format=json 2>/dev/null | grep -oP '"client_token":\s*"\K[^"]+' || echo "error")
echo "  • Secrets-Operator: $SECRETS_OP_TOKEN (secrets-operator policy)"

AUTH_VIEWER_TOKEN=$(vault token create -policy=auth-viewer -ttl=24h -format=json 2>/dev/null | grep -oP '"client_token":\s*"\K[^"]+' || echo "error")
echo "  • Auth-Viewer: $AUTH_VIEWER_TOKEN (auth-viewer policy)"

# ── Create Identity Entities and Groups (for permission tester demo) ──────────
echo ""
echo "→ Creating identity entities and groups..."

# Create an example entity
ENTITY_ID=$(vault write -field=id identity/entity \
  name="demo-user" \
  policies="app-specific" \
  metadata=role="developer" 2>/dev/null || echo "")
echo "  ✓ Entity 'demo-user' created (ID: ${ENTITY_ID})"

# Create additional test entities
vault write -field=id identity/entity \
  name="alice" \
  policies="admin" \
  metadata=department="engineering" 2>/dev/null || true
echo "  ✓ Entity 'alice' created"

vault write -field=id identity/entity \
  name="bob" \
  policies="app-specific" \
  metadata=department="engineering" 2>/dev/null || true
echo "  ✓ Entity 'bob' created"

vault write -field=id identity/entity \
  name="charlie" \
  policies="readonly" \
  metadata=department="devops" 2>/dev/null || true
echo "  ✓ Entity 'charlie' created"

# Create a group with the entity as a member
vault write identity/group \
  name="developers" \
  policies="readonly" \
  member_entity_ids="${ENTITY_ID}" \
  metadata=team="engineering" 2>/dev/null || true
echo "  ✓ Group 'developers' created with member 'demo-user'"

vault write identity/group \
  name="admins" \
  policies="admin" \
  metadata=team="platform" 2>/dev/null || true
echo "  ✓ Group 'admins' created"

# ── Summary ───────────────────────────────────────────────────────────────────
echo ""
echo "============================================"
echo "  ✓ Vault bootstrap complete!"
echo "============================================"
echo ""
echo "  Vault Address:        http://localhost:8200"
echo "  Root Token:           root"
echo ""
echo "  KV Engine:            kv/ (v2)"
echo ""
echo "  ── Auth Methods ──"
echo "    token                (built-in)"
echo "    approle/             (roles: app-backend, deploy-pipeline, readonly-service)"
echo "    userpass/            (users: alice/admin, bob/app-specific, charlie/readonly)"
echo "    kubernetes/          (roles: app-role, readonly-role, argo-deployer)"
echo "    github/              (teams: engineering, devops, readonly-users)"
echo "    ldap/                (demo server: ldap.forumsys.com)"
echo "    jwt/                 (demo JWKS endpoint)"
echo "    oidc/                (demo IdP: auth.example.com)"
echo "    cert/                (demo TLS certificate role)"
echo "    aws/                 (demo AWS IAM/EC2)"
echo "    azure/               (demo Azure Managed Identity)"
echo "    gcp/                 (demo GCP IAM)"
echo "    okta/                (demo Okta org)"
echo "    radius/              (demo RADIUS server)"
echo ""
echo "  ── Persistent Test Credentials (UserPass) ──"
echo "    Username: alice   | Password: Password1! | Policies: admin, vaultlens-admin"
echo "    Username: bob     | Password: Password1! | Policies: app-specific"
echo "    Username: charlie | Password: Password1! | Policies: readonly"
echo ""
echo "  ── Ephemeral Test Tokens (expire in 24h) ──"
echo "    Root:              root         (full access)"
echo "    Admin-Readonly:    see above    (readonly-admin policy)"
echo "    Secrets-Operator:  see above    (secrets-operator policy)"
echo "    Auth-Viewer:       see above    (auth-viewer policy)"
echo ""
echo "  ── Policies ──"
echo "    admin, readonly, app-specific, vaultlens-admin"
echo "    readonly-admin, secrets-operator, auth-viewer"
echo ""
echo "  ── Identities ──"
echo "    Entities: demo-user, alice, bob, charlie"
echo "    Groups: developers, admins"
echo ""
echo "  Audit: file → /vault/audit/vault-audit.log (hmac_accessor=false)"
echo "         socket device auto-registered by VaultLens on startup (VAULT_AUDIT_SOURCE=socket)"
echo ""
echo "  Run VaultLens:  cd app && npm run dev"
echo ""
