#!/bin/sh
set -e

echo "============================================"
echo "  VaultLens — Audit Demo Failures (dev only)"
echo "============================================"
echo ""
echo "Optional dev-compose service — generates a few deliberately-failing Vault"
echo "logins so the audit error badges in the UI have example data on a fresh"
echo "F5. Not part of the app itself and not used in production."

# ── Wait for Vault readiness ──────────────────────────────────────────────────
echo ""
echo "→ Waiting for Vault to be ready..."
until vault status > /dev/null 2>&1; do
  echo "  Vault not ready yet, retrying in 2s..."
  sleep 2
done
echo "✓ Vault is ready"

# ── Register the socket audit device ──────────────────────────────────────────
# "vault audit enable" itself tests connectivity to the address, so retrying it
# doubles as our wait for VaultLens (running with VAULT_AUDIT_SOURCE=socket) to
# be listening — no app code involved. A stale device from a previous app
# process (different port/process instance) would otherwise block ALL Vault
# requests, since Vault fails closed when a configured audit device can't be
# reached — so disable-then-enable on every attempt instead of trying to parse
# Vault's error text for an "already registered" case.
AUDIT_ADDR="${VAULT_AUDIT_SOCKET_VAULT_ADDRESS:-host.docker.internal:9090}"
echo ""
echo "→ Registering socket audit device (address=$AUDIT_ADDR)..."
until vault audit enable -path=vaultlens-socket-demo socket \
  address="$AUDIT_ADDR" \
  socket_type=tcp \
  write_timeout=5s \
  hmac_accessor=false > /dev/null 2>&1; do
  echo "  VaultLens socket not reachable yet ($AUDIT_ADDR) — retrying in 2s..."
  sleep 2
  vault audit disable vaultlens-socket-demo > /dev/null 2>&1 || true
done
echo "✓ Socket audit device registered"

# ── Fire a handful of deliberately-failing logins ─────────────────────────────
echo ""
echo "→ Generating example audit failures (bad Kubernetes/GitHub logins)..."
for role in app-role argo-deployer readonly-role; do
  vault write auth/kubernetes/login role="$role" jwt="invalid.demo.jwt" >/dev/null 2>&1 || true
done
vault write auth/github/login token="invalid-demo-token" >/dev/null 2>&1 || true
echo "✓ Example audit failures generated — check the Auth Methods pages in VaultLens"
