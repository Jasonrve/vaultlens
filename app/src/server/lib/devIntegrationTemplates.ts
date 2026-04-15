/**
 * Developer integration guide templates for each Vault auth method type.
 *
 * Templates use {{VARIABLE}} placeholders that are substituted server-side:
 *   {{VAULT_ADDR}}        — Vault server URL
 *   {{ROLE_NAME}}         — The role name
 *   {{MOUNT_PATH}}        — Auth mount path (without trailing slash)
 *   {{TOKEN_POLICIES}}    — Comma-separated list of token policies
 *   Auth-type-specific variables (see each template).
 *
 * To customise a template per installation, admins can store an override
 * in config-storage under section `devtemplate-<authType>`, key `content`.
 */

export const defaultTemplates: Record<string, string> = {

  // ── AppRole ──────────────────────────────────────────────────────────────
  approle: `# AppRole Integration Guide

This guide shows how your application can authenticate to Vault using the **{{ROLE_NAME}}** AppRole role.

## How AppRole Works

AppRole uses two credentials:
- **Role ID** — a stable identifier (like a username), safe to embed in config
- **Secret ID** — a short-lived credential (like a password), fetched at deploy time

Your application exchanges both for a Vault token.

---

## Step 1: Obtain the Role ID

The Role ID is fixed and can be stored in your application config.

\`\`\`bash
vault read auth/{{MOUNT_PATH}}/role/{{ROLE_NAME}}/role-id
\`\`\`

> Ask your Vault admin for the Role ID value if you don't have Vault CLI access.

## Step 2: Generate a Secret ID at Deploy Time

Secret IDs should be generated fresh for each deployment, not stored.

\`\`\`bash
# Generate a secret-id (requires a privileged token or CI credentials)
vault write -f auth/{{MOUNT_PATH}}/role/{{ROLE_NAME}}/secret-id
\`\`\`

In CI/CD, use a workflow identity (e.g. GitHub Actions OIDC) or a scoped token to call this endpoint.

## Step 3: Authenticate

\`\`\`bash
# Exchange role_id + secret_id for a Vault token
vault write auth/{{MOUNT_PATH}}/login \
  role_id="<ROLE_ID>" \
  secret_id="<SECRET_ID>"
\`\`\`

**cURL example:**

\`\`\`bash
curl -s --request POST \\
  "{{VAULT_ADDR}}/v1/auth/{{MOUNT_PATH}}/login" \\
  --data '{"role_id":"<ROLE_ID>","secret_id":"<SECRET_ID>"}' \\
  | jq -r '.auth.client_token'
\`\`\`

## SDK Examples

**Python (hvac):**
\`\`\`python
import hvac

client = hvac.Client(url="{{VAULT_ADDR}}")
client.auth.approle.login(
    role_id="<ROLE_ID>",
    secret_id="<SECRET_ID>",
    mount_point="{{MOUNT_PATH}}",
)
# Token is automatically set — start reading secrets:
secret = client.secrets.kv.v2.read_secret_version(path="my-app/config")
\`\`\`

**Go (vault-client-go):**
\`\`\`go
import (
    vault "github.com/hashicorp/vault-client-go"
    "github.com/hashicorp/vault-client-go/schema"
)

client, _ := vault.New(vault.WithAddress("{{VAULT_ADDR}}"))
resp, _ := client.Auth.AppRoleLogin(ctx, schema.AppRoleLoginRequest{
    RoleId:   "<ROLE_ID>",
    SecretId: "<SECRET_ID>",
}, vault.WithMountPath("{{MOUNT_PATH}}"))
client.SetToken(resp.Auth.ClientToken)
\`\`\`

## Role Reference

| Property | Value |
|----------|-------|
| Role Name | \`{{ROLE_NAME}}\` |
| Mount Path | \`auth/{{MOUNT_PATH}}\` |
| Token Policies | {{TOKEN_POLICIES}} |
`,

  // ── AWS ──────────────────────────────────────────────────────────────────
  aws: `# AWS Auth Integration Guide

This guide shows how AWS workloads authenticate to Vault using the **{{ROLE_NAME}}** role.

## How AWS Auth Works

Vault verifies your AWS identity by calling AWS STS APIs — no static credentials required. Two sub-methods are supported:

- **IAM** (recommended) — any AWS principal (Lambda, ECS, EC2, IAM user) signs an \`sts:GetCallerIdentity\` request
- **EC2** — verifies the EC2 instance identity document

---

## IAM Method (Recommended)

**From any AWS service (Lambda, ECS, EC2, GitHub Actions with OIDC, etc.):**

\`\`\`bash
# Using vault CLI with AWS credentials in environment
vault login -method=aws \\
  -path={{MOUNT_PATH}} \\
  role={{ROLE_NAME}}
\`\`\`

**cURL (using AWS SDK to sign the request):**
\`\`\`bash
# Use the vault AWS auth helper or sign manually:
# See: https://developer.hashicorp.com/vault/docs/auth/aws#generating-the-iam-request

VAULT_TOKEN=$(vault login -method=aws -path={{MOUNT_PATH}} role={{ROLE_NAME}} -token-only)
\`\`\`

**Python (hvac):**
\`\`\`python
import boto3, hvac

client = hvac.Client(url="{{VAULT_ADDR}}")
client.auth.aws.iam_login(
    access_key=boto3.Session().get_credentials().access_key,
    secret_key=boto3.Session().get_credentials().secret_key,
    session_token=boto3.Session().get_credentials().token,
    role="{{ROLE_NAME}}",
    mount_point="{{MOUNT_PATH}}",
)
\`\`\`

**Go:**
\`\`\`go
import (
    vault "github.com/hashicorp/vault-client-go"
    awsAuth "github.com/hashicorp/vault-client-go/schema"
)

// See full example:
// https://github.com/hashicorp/vault-client-go/blob/main/docs/AuthAwsLoginRequest.md
\`\`\`

## GitHub Actions Example

\`\`\`yaml
- name: Authenticate to Vault
  uses: hashicorp/vault-action@v3
  with:
    url: {{VAULT_ADDR}}
    method: aws
    path: {{MOUNT_PATH}}
    role: {{ROLE_NAME}}
    secrets: |
      secret/data/my-app/config password | DB_PASSWORD
\`\`\`

## Role Reference

| Property | Value |
|----------|-------|
| Role Name | \`{{ROLE_NAME}}\` |
| Mount Path | \`auth/{{MOUNT_PATH}}\` |
| Bound IAM ARNs | {{BOUND_IAM_ROLE_ARNS}} |
| Token Policies | {{TOKEN_POLICIES}} |
`,

  // ── Azure ─────────────────────────────────────────────────────────────────
  azure: `# Azure Auth Integration Guide

This guide shows how Azure workloads authenticate to Vault using the **{{ROLE_NAME}}** role with Managed Identity.

## How Azure Auth Works

Azure VMs, App Services, AKS pods, and other Azure resources with a **Managed Identity** can authenticate to Vault by presenting an MSI JWT token signed by Azure AD.

---

## Step 1: Enable Managed Identity on your Resource

In the Azure Portal (or CLI), assign a system-assigned or user-assigned managed identity to your compute resource.

\`\`\`bash
# Azure CLI: enable system-assigned identity on a VM
az vm identity assign --name my-vm --resource-group my-rg
\`\`\`

## Step 2: Authenticate from within Azure

\`\`\`bash
# From any Azure resource with a managed identity:
# 1. Fetch the MSI token from the Azure metadata service
MSI_TOKEN=$(curl -s \\
  "http://169.254.169.254/metadata/identity/oauth2/token?api-version=2018-02-01&resource=https://management.azure.com/" \\
  -H "Metadata: true" | jq -r '.access_token')

SUBSCRIPTION_ID=$(curl -s \\
  "http://169.254.169.254/metadata/instance?api-version=2021-02-01" \\
  -H "Metadata: true" | jq -r '.compute.subscriptionId')

RESOURCE_GROUP=$(curl -s \\
  "http://169.254.169.254/metadata/instance?api-version=2021-02-01" \\
  -H "Metadata: true" | jq -r '.compute.resourceGroupName')

VM_NAME=$(curl -s \\
  "http://169.254.169.254/metadata/instance?api-version=2021-02-01" \\
  -H "Metadata: true" | jq -r '.compute.name')

# 2. Login to Vault
curl -s --request POST \\
  "{{VAULT_ADDR}}/v1/auth/{{MOUNT_PATH}}/login" \\
  --data "{
    \\"role\\": \\"{{ROLE_NAME}}\\",
    \\"jwt\\": \\"\${MSI_TOKEN}\\",
    \\"subscription_id\\": \\"\${SUBSCRIPTION_ID}\\",
    \\"resource_group_name\\": \\"\${RESOURCE_GROUP}\\",
    \\"vm_name\\": \\"\${VM_NAME}\\"
  }"
\`\`\`

## Python Example (hvac)

\`\`\`python
import requests, hvac

# Fetch MSI token
msi_resp = requests.get(
    "http://169.254.169.254/metadata/identity/oauth2/token",
    params={"api-version": "2018-02-01", "resource": "https://management.azure.com/"},
    headers={"Metadata": "true"},
).json()

# Fetch instance metadata
instance = requests.get(
    "http://169.254.169.254/metadata/instance",
    params={"api-version": "2021-02-01"},
    headers={"Metadata": "true"},
).json()

client = hvac.Client(url="{{VAULT_ADDR}}")
client.auth.azure.login(
    role="{{ROLE_NAME}}",
    jwt=msi_resp["access_token"],
    subscription_id=instance["compute"]["subscriptionId"],
    resource_group_name=instance["compute"]["resourceGroupName"],
    vm_name=instance["compute"]["name"],
    mount_point="{{MOUNT_PATH}}",
)
\`\`\`

## Role Reference

| Property | Value |
|----------|-------|
| Role Name | \`{{ROLE_NAME}}\` |
| Mount Path | \`auth/{{MOUNT_PATH}}\` |
| Bound Subscription IDs | {{BOUND_SUBSCRIPTION_IDS}} |
| Bound Resource Groups | {{BOUND_RESOURCE_GROUPS}} |
| Token Policies | {{TOKEN_POLICIES}} |
`,

  // ── TLS Certificate ───────────────────────────────────────────────────────
  cert: `# TLS Certificate Auth Integration Guide

This guide shows how to authenticate to Vault using a TLS client certificate with the **{{ROLE_NAME}}** role.

## How Cert Auth Works

Your client presents a TLS certificate during the mTLS handshake. Vault verifies the certificate against the configured CA and the role bindings (CN, OU, DNS SANs, etc.).

---

## Prerequisites

You need a client certificate signed by the CA your Vault admin registered. Ask your Vault admin for:
- The CA certificate (to trust the Vault server)
- A signed client certificate + private key for your application

## Authenticate with cURL

\`\`\`bash
curl -s --request POST \\
  "{{VAULT_ADDR}}/v1/auth/{{MOUNT_PATH}}/login" \\
  --cert /path/to/client.crt \\
  --key /path/to/client.key \\
  --cacert /path/to/vault-ca.crt \\
  --data '{"name":"{{ROLE_NAME}}"}'
\`\`\`

## Authenticate with vault CLI

\`\`\`bash
vault login \\
  -method=cert \\
  -path={{MOUNT_PATH}} \\
  -client-cert=/path/to/client.crt \\
  -client-key=/path/to/client.key \\
  name={{ROLE_NAME}}
\`\`\`

## Python (hvac)

\`\`\`python
import hvac

client = hvac.Client(
    url="{{VAULT_ADDR}}",
    cert=("/path/to/client.crt", "/path/to/client.key"),
    verify="/path/to/vault-ca.crt",
)
client.auth.cert.login(cert_role_name="{{ROLE_NAME}}", mount_point="{{MOUNT_PATH}}")
\`\`\`

## Kubernetes Pod Example

Mount your client certificate from a Kubernetes Secret:

\`\`\`yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: my-app
spec:
  template:
    spec:
      containers:
        - name: app
          image: my-app:latest
          env:
            - name: VAULT_ADDR
              value: "{{VAULT_ADDR}}"
            - name: VAULT_CLIENT_CERT
              value: /vault/certs/tls.crt
            - name: VAULT_CLIENT_KEY
              value: /vault/certs/tls.key
          volumeMounts:
            - name: vault-certs
              mountPath: /vault/certs
              readOnly: true
      volumes:
        - name: vault-certs
          secret:
            secretName: my-app-vault-cert  # Secret containing tls.crt + tls.key
\`\`\`

## Role Reference

| Property | Value |
|----------|-------|
| Role Name | \`{{ROLE_NAME}}\` |
| Mount Path | \`auth/{{MOUNT_PATH}}\` |
| Token Policies | {{TOKEN_POLICIES}} |
`,

  // ── GCP ───────────────────────────────────────────────────────────────────
  gcp: `# GCP Auth Integration Guide

This guide shows how GCP workloads authenticate to Vault using the **{{ROLE_NAME}}** role.

## How GCP Auth Works

Vault verifies GCP identity using **Google's identity tokens** — no static service account keys required. Two sub-methods:

- **IAM** — any GCP principal (Cloud Run, GKE, Compute Engine, Cloud Functions)
- **GCE** — Compute Engine instance identity

---

## From GKE with Workload Identity (Recommended)

\`\`\`yaml
# Annotate your Kubernetes ServiceAccount to bind it to a GCP SA
apiVersion: v1
kind: ServiceAccount
metadata:
  name: my-app-ksa
  namespace: default
  annotations:
    iam.gke.io/gcp-service-account: my-app-sa@my-project.iam.gserviceaccount.com
\`\`\`

\`\`\`bash
# From within the pod, get an identity token and login to Vault
JWT=$(curl -s \\
  "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/identity?audience={{VAULT_ADDR}}&format=full" \\
  -H "Metadata-Flavor: Google")

curl -s --request POST \\
  "{{VAULT_ADDR}}/v1/auth/{{MOUNT_PATH}}/login" \\
  --data "{
    \\"role\\": \\"{{ROLE_NAME}}\\",
    \\"jwt\\": \\"\${JWT}\"
  }"
\`\`\`

## Python (hvac + google-auth)

\`\`\`python
import hvac
import google.auth.transport.requests
import google.oauth2.id_token

# Get an identity token for the Vault audience
request = google.auth.transport.requests.Request()
token = google.oauth2.id_token.fetch_id_token(request, "{{VAULT_ADDR}}")

client = hvac.Client(url="{{VAULT_ADDR}}")
client.auth.gcp.login(
    role="{{ROLE_NAME}}",
    jwt=token,
    mount_point="{{MOUNT_PATH}}",
)
\`\`\`

## vault CLI

\`\`\`bash
vault login \\
  -method=gcp \\
  -path={{MOUNT_PATH}} \\
  role={{ROLE_NAME}} \\
  jwt_exp=15m
\`\`\`

## Role Reference

| Property | Value |
|----------|-------|
| Role Name | \`{{ROLE_NAME}}\` |
| Mount Path | \`auth/{{MOUNT_PATH}}\` |
| Bound Service Accounts | {{BOUND_SERVICE_ACCOUNTS}} |
| Bound Projects | {{BOUND_PROJECTS}} |
| Token Policies | {{TOKEN_POLICIES}} |
`,

  // ── GitHub ────────────────────────────────────────────────────────────────
  github: `# GitHub Auth Integration Guide

This guide shows how GitHub identities authenticate to Vault using the **{{ROLE_NAME}}** role.

## How GitHub Auth Works

Vault accepts a **GitHub personal access token (PAT)** or a **GitHub Actions OIDC token** and verifies the user's GitHub organisation membership and team membership.

---

## Option 1: GitHub Actions (OIDC — No PAT Required)

This is the recommended approach for CI/CD pipelines. Uses hashicorp/vault-action:

\`\`\`yaml
# .github/workflows/deploy.yml
jobs:
  deploy:
    runs-on: ubuntu-latest
    permissions:
      id-token: write   # Required for OIDC
      contents: read

    steps:
      - uses: actions/checkout@v4

      - name: Authenticate to Vault
        uses: hashicorp/vault-action@v3
        with:
          url: {{VAULT_ADDR}}
          method: github
          path: {{MOUNT_PATH}}
          githubToken: \${{ secrets.GITHUB_TOKEN }}
          secrets: |
            secret/data/my-app/config password | DB_PASSWORD ;
            secret/data/my-app/config api_key  | API_KEY

      - name: Use secrets
        run: echo "DB_PASSWORD is set"  # Don't print the value!
\`\`\`

## Option 2: Personal Access Token (Local Development)

> **Note:** PATs are less secure than OIDC. Use only for local development/testing.

\`\`\`bash
# Create a GitHub PAT with \`read:org\` scope
# https://github.com/settings/tokens

vault login \\
  -method=github \\
  -path={{MOUNT_PATH}} \\
  token=<GITHUB_PAT>
\`\`\`

\`\`\`bash
# cURL
curl -s --request POST \\
  "{{VAULT_ADDR}}/v1/auth/{{MOUNT_PATH}}/login" \\
  --data '{"token":"<GITHUB_PAT>"}'
\`\`\`

## Python (hvac)

\`\`\`python
import hvac

client = hvac.Client(url="{{VAULT_ADDR}}")
client.auth.github.login(
    token="<GITHUB_PAT>",
    mount_point="{{MOUNT_PATH}}",
)
\`\`\`

## Role Reference

| Property | Value |
|----------|-------|
| Role Name | \`{{ROLE_NAME}}\` |
| Mount Path | \`auth/{{MOUNT_PATH}}\` |
| Token Policies | {{TOKEN_POLICIES}} |
`,

  // ── JWT ───────────────────────────────────────────────────────────────────
  jwt: `# JWT Auth Integration Guide

This guide shows how to authenticate to Vault using a JWT token with the **{{ROLE_NAME}}** role.

## How JWT Auth Works

Your application obtains a JWT from its identity provider (e.g. Auth0, Keycloak, Okta, Dex, SPIFFE/SPIRE) and exchanges it for a Vault token. Vault validates the JWT signature against the configured JWKS endpoint or public key.

---

## Step 1: Obtain a JWT from Your Identity Provider

How you get the JWT depends on your provider. Common examples:

\`\`\`bash
# Auth0 client credentials flow
curl -s --request POST \\
  "https://<YOUR_DOMAIN>.auth0.com/oauth/token" \\
  --data '{"client_id":"<CLIENT_ID>","client_secret":"<SECRET>","audience":"<AUDIENCE>","grant_type":"client_credentials"}' \\
  -H "Content-Type: application/json" \\
  | jq -r '.access_token'
\`\`\`

\`\`\`bash
# SPIFFE/SPIRE (from within a workload)
# JWT-SVIDs are written to unix:///tmp/agent.sock
spiffe-helper fetch -socketPath unix:///tmp/agent.sock
\`\`\`

## Step 2: Authenticate to Vault

\`\`\`bash
vault write auth/{{MOUNT_PATH}}/login \\
  role={{ROLE_NAME}} \\
  jwt=<JWT_TOKEN>
\`\`\`

\`\`\`bash
# cURL
curl -s --request POST \\
  "{{VAULT_ADDR}}/v1/auth/{{MOUNT_PATH}}/login" \\
  --data "{
    \\"role\\": \\"{{ROLE_NAME}}\\",
    \\"jwt\\": \\"<JWT_TOKEN>\\"
  }"
\`\`\`

## Python (hvac)

\`\`\`python
import hvac

client = hvac.Client(url="{{VAULT_ADDR}}")
client.auth.jwt.login(
    role="{{ROLE_NAME}}",
    jwt="<JWT_TOKEN>",
    mount_point="{{MOUNT_PATH}}",
)
\`\`\`

## GitHub Actions with OIDC

\`\`\`yaml
jobs:
  deploy:
    runs-on: ubuntu-latest
    permissions:
      id-token: write
      contents: read
    steps:
      - name: Authenticate to Vault (JWT/OIDC)
        uses: hashicorp/vault-action@v3
        with:
          url: {{VAULT_ADDR}}
          method: jwt
          path: {{MOUNT_PATH}}
          role: {{ROLE_NAME}}
          jwtGithubAudience: https://vault.example.com
          secrets: |
            secret/data/my-app/config password | DB_PASSWORD
\`\`\`

## Role Reference

| Property | Value |
|----------|-------|
| Role Name | \`{{ROLE_NAME}}\` |
| Mount Path | \`auth/{{MOUNT_PATH}}\` |
| Bound Audiences | {{BOUND_AUDIENCES}} |
| Token Policies | {{TOKEN_POLICIES}} |
`,

  // ── Kubernetes ────────────────────────────────────────────────────────────
  kubernetes: `# Kubernetes Integration Guide

This guide shows how to authenticate Kubernetes workloads to Vault using the **{{ROLE_NAME}}** role on the **{{MOUNT_PATH}}** auth mount.

## Prerequisites

- Kubernetes cluster with network access to Vault
- ServiceAccount matching: **{{SA_NAMES}}** in namespace **{{SA_NAMESPACES}}**

---

## Option 1: Vault Secrets Operator (VSO) — Recommended

VSO runs as an operator in your cluster and syncs Vault secrets to Kubernetes Secrets automatically.

### 1. Install VSO

\`\`\`bash
helm repo add hashicorp https://helm.releases.hashicorp.com
helm install vault-secrets-operator hashicorp/vault-secrets-operator \\
  --namespace vault-secrets-operator-system \\
  --create-namespace
\`\`\`

### 2. Create the ServiceAccount

\`\`\`yaml
apiVersion: v1
kind: ServiceAccount
metadata:
  name: {{SA_NAME_0}}
  namespace: {{SA_NAMESPACE_0}}
\`\`\`

### 3. Create a VaultConnection

\`\`\`yaml
apiVersion: secrets.hashicorp.com/v1beta1
kind: VaultConnection
metadata:
  name: vault-connection
  namespace: {{SA_NAMESPACE_0}}
spec:
  address: {{VAULT_ADDR}}
\`\`\`

### 4. Create a VaultAuth

\`\`\`yaml
apiVersion: secrets.hashicorp.com/v1beta1
kind: VaultAuth
metadata:
  name: {{ROLE_NAME}}-auth
  namespace: {{SA_NAMESPACE_0}}
spec:
  method: kubernetes
  mount: {{MOUNT_PATH}}
  kubernetes:
    role: {{ROLE_NAME}}
    serviceAccount: {{SA_NAME_0}}
    audiences:
      - vault
  vaultConnectionRef: vault-connection
\`\`\`

### 5. Sync a Static Secret (KV)

\`\`\`yaml
apiVersion: secrets.hashicorp.com/v1beta1
kind: VaultStaticSecret
metadata:
  name: my-app-config
  namespace: {{SA_NAMESPACE_0}}
spec:
  type: kv-v2
  mount: secret
  path: my-app/config
  destination:
    name: my-app-config          # Kubernetes Secret name
    create: true
  vaultAuthRef: {{ROLE_NAME}}-auth
  refreshAfter: 60s
\`\`\`

### 6. Use the Secret in your Deployment

\`\`\`yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: my-app
  namespace: {{SA_NAMESPACE_0}}
spec:
  template:
    spec:
      serviceAccountName: {{SA_NAME_0}}
      containers:
        - name: app
          image: my-app:latest
          envFrom:
            - secretRef:
                name: my-app-config
\`\`\`

---

## Option 2: Vault Agent Injector

Add annotations to your Pod template to inject secrets as files or environment variables:

\`\`\`yaml
annotations:
  vault.hashicorp.com/agent-inject: "true"
  vault.hashicorp.com/role: "{{ROLE_NAME}}"
  vault.hashicorp.com/auth-path: "auth/{{MOUNT_PATH}}"
  vault.hashicorp.com/agent-inject-secret-config.env: "secret/data/my-app/config"
  vault.hashicorp.com/agent-inject-template-config.env: |
    {{- with secret "secret/data/my-app/config" -}}
    export DB_PASSWORD="{{ .Data.data.password }}"
    {{- end -}}
\`\`\`

Enable the injector (if not already installed):
\`\`\`bash
helm install vault hashicorp/vault \\
  --set "injector.enabled=true" \\
  --set "server.enabled=false"
\`\`\`

---

## Option 3: Direct API / SDK

From within a Pod, authenticate using the pod's ServiceAccount JWT:

\`\`\`bash
VAULT_ADDR="{{VAULT_ADDR}}"
SA_JWT=$(cat /var/run/secrets/kubernetes.io/serviceaccount/token)

curl -s --request POST \\
  "\${VAULT_ADDR}/v1/auth/{{MOUNT_PATH}}/login" \\
  --data "{
    \\"jwt\\": \\"\${SA_JWT}\\",
    \\"role\\": \\"{{ROLE_NAME}}\\"
  }" | jq -r '.auth.client_token'
\`\`\`

**Go SDK:**

\`\`\`go
import (
    vault "github.com/hashicorp/vault-client-go"
    "github.com/hashicorp/vault-client-go/auth/kubernetes"
)

client, _ := vault.New(vault.WithAddress("{{VAULT_ADDR}}"))
k8sAuth, _ := kubernetes.New(kubernetes.WithMountPath("{{MOUNT_PATH}}"))
resp, _ := client.Auth.KubernetesLogin(context.Background(),
    schema.KubernetesLoginRequest{Role: "{{ROLE_NAME}}", Jwt: saJWT},
    vault.WithMountPath("{{MOUNT_PATH}}"),
)
client.SetToken(resp.Auth.ClientToken)
\`\`\`

## Role Reference

| Property | Value |
|----------|-------|
| Role Name | \`{{ROLE_NAME}}\` |
| Mount Path | \`auth/{{MOUNT_PATH}}\` |
| Bound Service Accounts | \`{{SA_NAMES}}\` |
| Bound Namespaces | \`{{SA_NAMESPACES}}\` |
| Token Policies | {{TOKEN_POLICIES}} |
`,

  // ── LDAP ──────────────────────────────────────────────────────────────────
  ldap: `# LDAP Auth Integration Guide

This guide shows how users and services can authenticate to Vault using LDAP credentials via the **{{MOUNT_PATH}}** mount.

## How LDAP Auth Works

Vault binds to your LDAP server with the provided username and password and verifies group membership against the configured role bindings.

---

## vault CLI

\`\`\`bash
vault login \\
  -method=ldap \\
  -path={{MOUNT_PATH}} \\
  username=<YOUR_LDAP_USERNAME>
# You will be prompted for your password
\`\`\`

## cURL

\`\`\`bash
curl -s --request POST \\
  "{{VAULT_ADDR}}/v1/auth/{{MOUNT_PATH}}/login/<YOUR_LDAP_USERNAME>" \\
  --data '{"password":"<YOUR_PASSWORD>"}' \\
  | jq -r '.auth.client_token'
\`\`\`

## Python (hvac)

\`\`\`python
import hvac

client = hvac.Client(url="{{VAULT_ADDR}}")
client.auth.ldap.login(
    username="<YOUR_LDAP_USERNAME>",
    password="<YOUR_PASSWORD>",
    mount_point="{{MOUNT_PATH}}",
)
\`\`\`

## Application Integration via Service Account

For non-interactive application login, bind an LDAP service account to the **{{ROLE_NAME}}** group:

\`\`\`bash
# Store credentials in environment variables (never hardcode):
export LDAP_USERNAME="svc_my_app"
export LDAP_PASSWORD="<from-secret-manager>"

VAULT_TOKEN=$(curl -s --request POST \\
  "{{VAULT_ADDR}}/v1/auth/{{MOUNT_PATH}}/login/\${LDAP_USERNAME}" \\
  --data "{
    \\"password\\": \\"\${LDAP_PASSWORD}\\"
  }" | jq -r '.auth.client_token')
\`\`\`

## Role Reference

| Property | Value |
|----------|-------|
| Role Name | \`{{ROLE_NAME}}\` |
| Mount Path | \`auth/{{MOUNT_PATH}}\` |
| Token Policies | {{TOKEN_POLICIES}} |
`,

  // ── OIDC ──────────────────────────────────────────────────────────────────
  oidc: `# OIDC Auth Integration Guide

This guide shows how to authenticate to Vault using OIDC with the **{{ROLE_NAME}}** role.

## How OIDC Auth Works

Vault acts as an OIDC relying party. Your users authenticate via your identity provider (Okta, Auth0, Google, Azure AD…) and Vault receives the ID token via a browser redirect.

---

## vault CLI (Interactive Browser Login)

\`\`\`bash
vault login \\
  -method=oidc \\
  -path={{MOUNT_PATH}} \\
  role={{ROLE_NAME}}
# Opens a browser for OIDC login — no credentials typed into the terminal
\`\`\`

## Web Application Integration

Your app must implement the OIDC authorization code flow:

\`\`\`
1. Redirect user to: {{VAULT_ADDR}}/v1/auth/{{MOUNT_PATH}}/oidc/auth_url
   with: role={{ROLE_NAME}}&redirect_uri=<YOUR_APP_CALLBACK>

2. User authenticates with the IdP

3. IdP redirects to your callback with ?code=...&state=...

4. Exchange the code for a Vault token:
   POST {{VAULT_ADDR}}/v1/auth/{{MOUNT_PATH}}/oidc/callback
   { "state": "...", "nonce": "...", "code": "..." }
\`\`\`

**Step 1 — Get the auth URL:**

\`\`\`bash
curl -s --request POST \\
  "{{VAULT_ADDR}}/v1/auth/{{MOUNT_PATH}}/oidc/auth_url" \\
  --data "{
    \\"role\\": \\"{{ROLE_NAME}}\\",
    \\"redirect_uri\\": \\"https://your-app.example.com/vault/callback\\"
  }" | jq -r '.data.auth_url'
# Redirect the user's browser to this URL
\`\`\`

**Step 4 — Exchange code for token:**

\`\`\`bash
curl -s --request GET \\
  "{{VAULT_ADDR}}/v1/auth/{{MOUNT_PATH}}/oidc/callback" \\
  -G \\
  --data-urlencode "state=<STATE>" \\
  --data-urlencode "nonce=<NONCE>" \\
  --data-urlencode "code=<CODE>"
\`\`\`

## Role Reference

| Property | Value |
|----------|-------|
| Role Name | \`{{ROLE_NAME}}\` |
| Mount Path | \`auth/{{MOUNT_PATH}}\` |
| Allowed Redirect URIs | {{ALLOWED_REDIRECT_URIS}} |
| Token Policies | {{TOKEN_POLICIES}} |
`,

  // ── Okta ──────────────────────────────────────────────────────────────────
  okta: `# Okta Auth Integration Guide

This guide shows how to authenticate to Vault using Okta credentials via the **{{MOUNT_PATH}}** mount.

## How Okta Auth Works

Vault delegates authentication to Okta using Okta's primary authentication API. Group membership in Okta is used to determine token policies.

---

## vault CLI

\`\`\`bash
vault login \\
  -method=okta \\
  -path={{MOUNT_PATH}} \\
  username=<YOUR_OKTA_EMAIL>
# You will be prompted for your Okta password (and MFA if required)
\`\`\`

## cURL

\`\`\`bash
curl -s --request POST \\
  "{{VAULT_ADDR}}/v1/auth/{{MOUNT_PATH}}/login/<YOUR_OKTA_EMAIL>" \\
  --data '{"password":"<YOUR_PASSWORD>"}' \\
  | jq -r '.auth.client_token'
\`\`\`

## Python (hvac)

\`\`\`python
import hvac

client = hvac.Client(url="{{VAULT_ADDR}}")
client.auth.okta.login(
    username="<YOUR_OKTA_EMAIL>",
    password="<YOUR_PASSWORD>",
    mount_point="{{MOUNT_PATH}}",
)
\`\`\`

## MFA Considerations

If your Okta organisation enforces MFA, the login request may return a \`287\` status indicating MFA is required. The response will include an \`mfa_requirement\` object.

\`\`\`bash
# Complete MFA by providing the TOTP code:
curl -s --request POST \\
  "{{VAULT_ADDR}}/v1/auth/mfa/validate" \\
  --header "X-Vault-Token: <MFA_REQUEST_ID_TOKEN>" \\
  --data '{
    "mfa_request_id": "<REQUEST_ID>",
    "mfa_payload": {
      "<MFA_METHOD_ID>": ["<TOTP_CODE>"]
    }
  }'
\`\`\`

## Role Reference

| Property | Value |
|----------|-------|
| Role Name | \`{{ROLE_NAME}}\` |
| Mount Path | \`auth/{{MOUNT_PATH}}\` |
| Token Policies | {{TOKEN_POLICIES}} |
`,

  // ── Radius ────────────────────────────────────────────────────────────────
  radius: `# RADIUS Auth Integration Guide

This guide shows how to authenticate to Vault using RADIUS credentials via the **{{MOUNT_PATH}}** mount.

## How RADIUS Auth Works

Vault forwards authentication requests to your RADIUS server. Successful authentication returns a Vault token with policies configured for your user or the default policies for this mount.

---

## vault CLI

\`\`\`bash
vault login \\
  -method=radius \\
  -path={{MOUNT_PATH}} \\
  username=<YOUR_RADIUS_USERNAME>
# You will be prompted for your RADIUS password
\`\`\`

## cURL

\`\`\`bash
curl -s --request POST \\
  "{{VAULT_ADDR}}/v1/auth/{{MOUNT_PATH}}/login/<YOUR_RADIUS_USERNAME>" \\
  --data '{"password":"<YOUR_PASSWORD>"}' \\
  | jq -r '.auth.client_token'
\`\`\`

## Python (hvac)

\`\`\`python
import hvac

client = hvac.Client(url="{{VAULT_ADDR}}")
client.auth.radius.login(
    username="<YOUR_RADIUS_USERNAME>",
    password="<YOUR_PASSWORD>",
    mount_point="{{MOUNT_PATH}}",
)
\`\`\`

## Role Reference

| Property | Value |
|----------|-------|
| Role Name | \`{{ROLE_NAME}}\` |
| Mount Path | \`auth/{{MOUNT_PATH}}\` |
| Token Policies | {{TOKEN_POLICIES}} |
`,

  // ── Token ─────────────────────────────────────────────────────────────────
  token: `# Token Role Integration Guide

This guide shows how to create tokens using the **{{ROLE_NAME}}** token role.

## How Token Roles Work

Token roles allow creation of tokens with pre-defined settings (TTL, policies, renewable). Only principals with appropriate permissions (usually CI/CD or other Vault tokens) can create tokens using this role.

---

## Create a Token with vault CLI

\`\`\`bash
vault token create \\
  -role={{ROLE_NAME}} \\
  -display-name=my-app-token
\`\`\`

## Create a Token via cURL

\`\`\`bash
curl -s --request POST \\
  "{{VAULT_ADDR}}/v1/auth/{{MOUNT_PATH}}/create/{{ROLE_NAME}}" \\
  --header "X-Vault-Token: <PARENT_TOKEN>" \\
  --data '{"display_name":"my-app-token","num_uses":0}' \\
  | jq -r '.auth.client_token'
\`\`\`

## Python (hvac)

\`\`\`python
import hvac

# Authenticate first (e.g. with AppRole or another method)
client = hvac.Client(url="{{VAULT_ADDR}}", token="<PARENT_TOKEN>")

new_token = client.auth.token.create_orphan(
    policies=["{{ROLE_NAME}}"],
    ttl="1h",
    display_name="my-app-token",
)
print(new_token["auth"]["client_token"])
\`\`\`

## Token Renewal

Tokens created from this role can be renewed before they expire:

\`\`\`bash
vault token renew <TOKEN>

# Or via cURL:
curl -s --request POST \\
  "{{VAULT_ADDR}}/v1/auth/token/renew-self" \\
  --header "X-Vault-Token: <TOKEN>"
\`\`\`

## Role Reference

| Property | Value |
|----------|-------|
| Role Name | \`{{ROLE_NAME}}\` |
| Mount Path | \`auth/{{MOUNT_PATH}}\` |
| Token Policies | {{TOKEN_POLICIES}} |
`,

  // ── Userpass ──────────────────────────────────────────────────────────────
  userpass: `# Userpass Auth Integration Guide

This guide shows how to authenticate to Vault with a username and password via the **{{MOUNT_PATH}}** mount.

## How Userpass Auth Works

Vault maintains an internal list of usernames and hashed passwords. Authentication is simple: provide username + password, receive a Vault token.

---

## vault CLI

\`\`\`bash
vault login \\
  -method=userpass \\
  -path={{MOUNT_PATH}} \\
  username=<YOUR_USERNAME>
# You will be prompted for your password
\`\`\`

## cURL

\`\`\`bash
curl -s --request POST \\
  "{{VAULT_ADDR}}/v1/auth/{{MOUNT_PATH}}/login/<YOUR_USERNAME>" \\
  --data '{"password":"<YOUR_PASSWORD>"}' \\
  | jq -r '.auth.client_token'
\`\`\`

## Python (hvac)

\`\`\`python
import hvac

client = hvac.Client(url="{{VAULT_ADDR}}")
client.auth.userpass.login(
    username="<YOUR_USERNAME>",
    password="<YOUR_PASSWORD>",
    mount_point="{{MOUNT_PATH}}",
)
\`\`\`

## Go

\`\`\`go
import vault "github.com/hashicorp/vault-client-go"

client, _ := vault.New(vault.WithAddress("{{VAULT_ADDR}}"))
resp, _ := client.Auth.UserpassLogin(ctx,
    "<YOUR_USERNAME>",
    schema.UserpassLoginRequest{Password: "<YOUR_PASSWORD>"},
    vault.WithMountPath("{{MOUNT_PATH}}"),
)
client.SetToken(resp.Auth.ClientToken)
\`\`\`

## Changing Your Password

\`\`\`bash
vault write auth/{{MOUNT_PATH}}/users/<YOUR_USERNAME>/password \\
  password=<NEW_PASSWORD>
\`\`\`

## Role Reference

| Property | Value |
|----------|-------|
| Role Name | \`{{ROLE_NAME}}\` |
| Mount Path | \`auth/{{MOUNT_PATH}}\` |
| Token Policies | {{TOKEN_POLICIES}} |
`,

};

/**
 * Supported auth type aliases — maps Vault type strings to template keys.
 */
export const AUTH_TYPE_ALIASES: Record<string, string> = {
  approle: 'approle',
  aws: 'aws',
  azure: 'azure',
  cert: 'cert',
  gcp: 'gcp',
  github: 'github',
  jwt: 'jwt',
  kubernetes: 'kubernetes',
  ldap: 'ldap',
  oidc: 'oidc',
  okta: 'okta',
  radius: 'radius',
  token: 'token',
  userpass: 'userpass',
};

/**
 * Returns the template key for a given Vault auth type string.
 * Falls back to the type itself if not in the alias map.
 */
export function resolveTemplateKey(authType: string): string {
  return AUTH_TYPE_ALIASES[authType.toLowerCase()] ?? authType.toLowerCase();
}

/**
 * Substitute {{VARIABLE}} placeholders in a template string.
 */
export function substituteTemplate(
  template: string,
  vars: Record<string, string>,
): string {
  return template.replace(/\{\{([A-Z0-9_]+)\}\}/g, (_match, key: string) => {
    return vars[key] ?? `{{${key}}}`;
  });
}
