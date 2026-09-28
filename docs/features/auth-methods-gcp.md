# GCP Auth

GCP auth verifies Google Cloud service-account or instance identity tokens and maps them to Vault roles and policies.

## Configure The Mount

Configure the GCP project, credentials used by Vault for verification, and the expected service-account or instance identity. Keep verifier credentials in Vault's server configuration.

## Roles

GCP roles bind projects, service accounts, or instance groups to Vault policies. Use the **Roles** tab to review identity constraints and token TTLs.

```bash
vault write auth/gcp/role/app-readonly \
  type=iam \
  bound_service_accounts=app@project.iam.gserviceaccount.com \
  bound_projects=project \
  policies=app-readonly
```

## Security Notes

Grant only the Google Cloud identities that require Vault access. Keep the Vault verifier configuration and application identity separate so an application cannot impersonate the verifier.
