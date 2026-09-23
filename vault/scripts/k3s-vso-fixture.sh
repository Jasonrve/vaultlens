#!/bin/sh
set -eu

until [ -f /shared/k3s.yaml ]; do
  sleep 1
done
sed -i 's#https://127.0.0.1:6443#https://k3s:6443#' /shared/k3s.yaml

echo "-> Waiting for k3s API..."
until kubectl get nodes >/dev/null 2>&1; do
  sleep 2
done

echo "-> Installing Vault Secrets Operator CRDs..."
for crd in \
  secrets.hashicorp.com_vaultauths.yaml \
  secrets.hashicorp.com_vaultauthglobals.yaml \
  secrets.hashicorp.com_vaultconnections.yaml \
  secrets.hashicorp.com_vaultdynamicsecrets.yaml \
  secrets.hashicorp.com_vaultpkisecrets.yaml \
  secrets.hashicorp.com_vaultstaticsecrets.yaml \
  secrets.hashicorp.com_secrettransformations.yaml \
  secrets.hashicorp.com_csisecrets.yaml; do
  kubectl apply -f "https://raw.githubusercontent.com/hashicorp/vault-secrets-operator/main/chart/crds/${crd}" >/dev/null 2>&1 || true
done

echo "-> Waiting for VSO CRDs..."
until kubectl get crd vaultauths.secrets.hashicorp.com >/dev/null 2>&1; do
  sleep 2
done

kubectl apply -f - <<'YAML'
apiVersion: v1
kind: ServiceAccount
metadata:
  name: vaultlens-vso-reader
  namespace: default
---
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRole
metadata:
  name: vaultlens-vso-reader
rules:
- apiGroups: ["secrets.hashicorp.com"]
  resources:
  - vaultauths
  - vaultauthglobals
  - vaultconnections
  - vaultdynamicsecrets
  - vaultpkisecrets
  - vaultstaticsecrets
  - secrettransformations
  - csisecrets
  verbs: ["get", "list"]
- apiGroups: [""]
  resources:
  - serviceaccounts
  - pods
  - pods/log
  verbs: ["get", "list"]
---
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRoleBinding
metadata:
  name: vaultlens-vso-reader
roleRef:
  apiGroup: rbac.authorization.k8s.io
  kind: ClusterRole
  name: vaultlens-vso-reader
subjects:
- kind: ServiceAccount
  name: vaultlens-vso-reader
  namespace: default
YAML

until TOKEN=$(kubectl create token vaultlens-vso-reader -n default 2>/dev/null) && [ -n "$TOKEN" ]; do
  sleep 2
done
printf '%s' "$TOKEN" > /shared/token
chmod 644 /shared/token

kubectl apply -f - <<'YAML'
apiVersion: secrets.hashicorp.com/v1beta1
kind: VaultConnection
metadata:
  name: local-vault
  namespace: default
spec:
  address: http://vault:8200
---
apiVersion: secrets.hashicorp.com/v1beta1
kind: VaultAuth
metadata:
  name: local-kubernetes
  namespace: default
spec:
  method: kubernetes
  mount: kubernetes-k3s
  kubernetes:
    role: app-role
    serviceAccount: vaultlens-vso-reader
---
apiVersion: secrets.hashicorp.com/v1beta1
kind: VaultAuth
metadata:
  name: broken-serviceaccount
  namespace: default
spec:
  method: kubernetes
  mount: kubernetes-k3s
  kubernetes:
    role: app-role
    serviceAccount: missing-sa
---
apiVersion: secrets.hashicorp.com/v1beta1
kind: VaultAuth
metadata:
  name: broken-role
  namespace: default
spec:
  method: kubernetes
  mount: kubernetes-k3s
  kubernetes:
    role: does-not-exist-role
    serviceAccount: vaultlens-vso-reader
---
apiVersion: secrets.hashicorp.com/v1beta1
kind: VaultStaticSecret
metadata:
  name: local-example
  namespace: default
spec:
  type: kv-v2
  mount: kv
  path: product/service/nprd/config
  destination:
    name: local-example
    create: true
  refreshAfter: 30s
  vaultAuthRef: local-kubernetes
---
apiVersion: secrets.hashicorp.com/v1beta1
kind: VaultStaticSecret
metadata:
  name: warning-example
  namespace: default
spec:
  type: kv-v2
  mount: kv
  path: product/service/nprd/config
  destination:
    name: warning-example
    create: true
  refreshAfter: 30s
  vaultAuthRef: local-kubernetes
---
apiVersion: secrets.hashicorp.com/v1beta1
kind: VaultStaticSecret
metadata:
  name: broken-authref
  namespace: default
spec:
  type: kv-v2
  mount: kv
  path: product/service/nprd/config
  destination:
    name: broken-authref
    create: true
  vaultAuthRef: does-not-exist-auth
---
apiVersion: secrets.hashicorp.com/v1beta1
kind: VaultStaticSecret
metadata:
  name: missing-destination
  namespace: default
spec:
  type: kv-v2
  mount: kv
  path: product/service/nprd/config
  destination:
    name: ghost-secret
    create: false
  vaultAuthRef: local-kubernetes
YAML

# The objects above only carry `spec` — `status` is a subresource the real VSO
# operator would populate by reconciling against the cluster and Vault. Since
# this fixture doesn't run the actual operator, patch in realistic conditions
# by hand so the VSO Resources tab has something of everything to show:
# healthy, warning, and error resources (both condition-driven and relation-
# driven, e.g. a still-"Ready" secret whose destination Secret was deleted).
NOW=$(date -u +%Y-%m-%dT%H:%M:%SZ)

patch_status() {
  kubectl patch "$1" "$2" -n default --subresource=status --type=merge -p "$3" >/dev/null 2>&1 || true
}

patch_status VaultAuth local-kubernetes \
  '{"status":{"conditions":[{"type":"Ready","status":"True","reason":"Verified","message":"Authentication verified","lastTransitionTime":"'"$NOW"'"}]}}'
patch_status VaultAuth broken-serviceaccount \
  '{"status":{"conditions":[{"type":"Ready","status":"False","reason":"ServiceAccountTokenError","message":"failed to fetch token for ServiceAccount default/missing-sa: serviceaccounts \"missing-sa\" not found","lastTransitionTime":"'"$NOW"'"}]}}'
patch_status VaultAuth broken-role \
  '{"status":{"conditions":[{"type":"Ready","status":"False","reason":"VaultLoginError","message":"login unsuccessful: role \"does-not-exist-role\" does not exist","lastTransitionTime":"'"$NOW"'"}]}}'
patch_status VaultStaticSecret local-example \
  '{"status":{"lastGeneration":1,"conditions":[{"type":"Ready","status":"True","reason":"Synced","message":"Secret synced","lastTransitionTime":"'"$NOW"'"}]}}'
patch_status VaultStaticSecret warning-example \
  '{"status":{"lastGeneration":1,"conditions":[{"type":"Ready","status":"Unknown","reason":"Reconciling","message":"Waiting for the next scheduled sync","lastTransitionTime":"'"$NOW"'"}]}}'
patch_status VaultStaticSecret broken-authref \
  '{"status":{"lastGeneration":1,"conditions":[{"type":"Ready","status":"Unknown","reason":"Pending","message":"Waiting to resolve VaultAuth reference","lastTransitionTime":"'"$NOW"'"}]}}'
patch_status VaultStaticSecret missing-destination \
  '{"status":{"lastGeneration":1,"conditions":[{"type":"Ready","status":"True","reason":"Synced","message":"Secret synced","lastTransitionTime":"'"$NOW"'"}]}}'

echo "k3s VSO fixture ready"
