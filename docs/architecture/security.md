# Security

This page documents VaultLens's security design, protections, and considerations.

## Threat Model

VaultLens is a proxy UI for Vault. Its security model inherits Vault's own ACL system — VaultLens does not grant users any more access than their Vault token allows. The primary threats addressed are:

- **Session hijacking** — mitigated by httpOnly cookies, CSRF protection, and per-request token validation
- **CSRF attacks** — mitigated by double-submit cookie pattern
- **Secret exposure** — mitigated by never logging secrets, strict CSP, and end-to-end encryption for sharing
- **SSRF** — mitigated by webhook URL blocklist
- **Path traversal** — mitigated by `encodeURIComponent()` on all Vault paths and `path.basename()` on filesystem paths
- **Credential leakage** — system token never returned in API responses; AppRole credentials stored encrypted

## Protections

### Authentication & Sessions
- Per-request token validation against Vault's `/auth/token/lookup-self` on every authenticated request
- Vault token stored in an **httpOnly, SameSite=Strict** cookie — not accessible to JavaScript
- CSRF **double-submit cookie** pattern on all state-changing routes
- Auth routes mounted before CSRF (by design — login creates new sessions)

### Transport Security
- **HSTS** (`Strict-Transport-Security`) enabled in production
- **Helmet** configured with strict CSP, `X-Frame-Options: DENY`, `Referrer-Policy: strict-origin`
- Non-root Docker container (UID 1001)

### Input Validation
- All Vault paths encoded with `encodeURIComponent()` before API calls
- All filesystem path parameters sanitized with `path.basename()`
- Webhook URLs validated against SSRF blocklist (loopback, private, metadata ranges blocked)
- Backup restore JSON structurally validated before processing
- Webhook endpoint UUIDs validated with UUID format regex
- Secret path validation on create/update (shape and length limits)

### Rate Limiting
- Global rate limiter on all `/api/*` routes (500 req / 15 min by default)
- Stricter per-minute limit on the public sharing endpoint (20 req / min)
- Configurable via `RATE_LIMIT_MAX`, `RATE_LIMIT_WINDOW_MS`, `SHARING_RATE_LIMIT_MAX`

### Secret Sharing
- End-to-end encrypted using **OpenPGP AES-256**
- Decryption key in URL fragment — never transmitted to server or included in logs
- 100 KB payload limit, 1,000 active share limit, batched cleanup
- One-time view option for ephemeral secrets

### System Token
- System token never returned in API responses or logged
- AppRole credentials encrypted at rest with AES-256-GCM
- Restricted-access fallback exposes field names only — never values

### Error Handling
- Centralized error handler returns generic messages only
- No stack traces or internal details in error responses
- VaultError status codes are passed through (403, 404) but messages are sanitized

## Content Security Policy (Production)

```
default-src 'self'
script-src 'self'
style-src 'self' 'unsafe-inline'
img-src 'self' data:
font-src 'self'
connect-src 'self'
frame-ancestors 'none'
```

## OWASP Top 10 Coverage

| Risk | Mitigation |
|------|-----------|
| A01 Broken Access Control | Per-request Vault token validation; `requireAdmin` middleware |
| A02 Cryptographic Failures | AES-256-GCM for stored credentials; OpenPGP for shared secrets; httpOnly cookies |
| A03 Injection | All paths encoded; no raw SQL; Vault API calls are parameterized |
| A04 Insecure Design | Defence-in-depth; minimal system token use; restricted-access never exposes values |
| A05 Security Misconfiguration | Helmet, strict CSP, HSTS, HPP, non-root Docker |
| A06 Vulnerable Components | Regular dependency updates via CI |
| A07 Auth & Session Failures | httpOnly cookies, CSRF, per-request validation, no persistent server-side sessions |
| A08 Software & Data Integrity | Backup restore validation; HMAC-signed webhooks |
| A09 Logging Failures | Morgan request logging with request ID; no secret values in logs |
| A10 SSRF | Webhook URL blocklist; no user-controlled HTTP calls except webhooks |

## Responsible Disclosure

See [SECURITY.md](https://github.com/Jasonrve/vaultlens/blob/main/SECURITY.md) for the vulnerability reporting process.
