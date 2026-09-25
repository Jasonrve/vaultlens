# Azure Auth

Azure auth validates Azure managed-identity or VM identity documents and maps them to Vault roles and policies.

## Configure The Mount

Configure the Azure tenant, resource, and subscription details required by Vault to verify the identity document. Use managed identity rather than storing client secrets where possible.

## Roles

Azure roles bind subscriptions, resource groups, or managed identities to Vault policies. Review the bindings and token settings in the **Roles** tab.

## Security Notes

Keep role bindings narrow. A managed identity with access to a resource group should not automatically receive policies intended for an entire subscription. Use separate Vault roles for different application trust boundaries.
