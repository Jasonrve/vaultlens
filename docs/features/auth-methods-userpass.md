# UserPass Auth

UserPass provides direct username-and-password authentication managed by Vault. It is convenient for small installations and break-glass access, but external identity providers are usually better for larger teams.

## Users And Policies

UserPass users are managed under the auth mount and receive policies directly or through configured metadata. VaultLens focuses the auth-method detail view on configuration and mount options; use Vault's user endpoints or CLI to manage credentials.

```bash
vault write auth/userpass/users/alice \
  password='use-a-secret-manager' \
  token_policies=app-readonly
```

## Security Notes

Use TLS between VaultLens and Vault, enforce short token TTLs, and avoid sharing UserPass credentials. Prefer OIDC, LDAP, or another centralized identity provider when you need SSO, MFA, or centralized offboarding.
