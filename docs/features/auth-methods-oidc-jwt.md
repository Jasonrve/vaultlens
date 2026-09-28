# OIDC and JWT Auth

OIDC and JWT auth validate signed tokens from an identity provider. OIDC adds an interactive browser login; JWT is commonly used for service-to-service authentication.

## OIDC Configuration

Use the **Configuration** tab to set the discovery URL, client ID, client secret, redirect behavior, and allowed response types. The provider must be configured with the Vault OIDC callback URL.

VaultLens supports OIDC login through a popup. The callback route is public by design so the popup can complete the login before the Vault session exists.

## JWT Configuration

JWT mounts can validate tokens with a JWKS URL, discovery URL, or configured public keys. Configure the expected issuer, audience, signing algorithms, and claim mappings. Do not accept more algorithms or issuers than the provider requires.

## Roles

JWT/OIDC roles map token claims to Vault policies. Typical constraints include issuer, audience, bound claims, and token TTLs. Use the **Roles** tab to review these mappings.

## Troubleshooting

An authentication failure usually means the issuer, audience, callback URL, clock, or signing-key configuration does not match the identity provider. Use the auth method audit entries to distinguish a rejected claim from a Vault policy issue.
