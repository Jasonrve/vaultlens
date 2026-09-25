# AWS Auth

AWS auth lets workloads authenticate to Vault with AWS IAM identity documents or AWS access keys. Vault verifies the AWS identity and maps it to a Vault role.

## Configure The Mount

Use **Configuration** to set the AWS region, bound account IDs, and IAM server settings required by the Vault deployment. Prefer workload identity or instance roles over long-lived access keys.

## Roles

AWS roles bind AWS account IDs, IAM role ARNs, or instance identities to Vault policies. Review the bindings and token TTLs in the **Roles** tab.

```bash
vault write auth/aws/role/ops-readonly \
  auth_type=iam \
  bound_iam_principal_arns=arn:aws:iam::123456789012:role/ops-readonly \
  policies=app-readonly
```

## Security Notes

Keep AWS credentials out of VaultLens configuration and browser requests. Scope role bindings to the exact accounts and principals that need access, and use short Vault token lifetimes.
