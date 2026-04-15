# Security Policy

## Supported Versions

Only the latest release on the `main` branch receives security fixes.

| Version            | Supported          |
|--------------------|--------------------|
| latest (`main`)    | ✅                 |
| older releases     | ❌                 |

---

## Reporting a Vulnerability

**Please do not open a public GitHub issue for security vulnerabilities.**

Use GitHub's private vulnerability reporting:
👉 [Report a vulnerability](https://github.com/Jasonrve/vaultlens/security/advisories/new)

This creates a private advisory visible only to repository maintainers. Please include:

1. **Description** — A clear description of the vulnerability
2. **Impact** — What an attacker could achieve
3. **Steps to Reproduce** — Detailed reproduction steps
4. **Affected Versions** — Which versions are affected
5. **Suggested Fix** (optional) — If you have a proposed fix

---

## Response Timeline

| Stage                          | Target SLA |
|-------------------------------|-----------|
| Initial acknowledgement        | 48 hours  |
| Triage and severity assessment | 5 days    |
| Fix + private advisory         | 30 days   |
| Public disclosure              | After fix is released |

---

## Scope

VaultLens is a management UI for HashiCorp Vault. Security issues in scope include:

- Authentication bypass or privilege escalation within VaultLens
- CSRF, XSS, or other injection vulnerabilities in the UI or API
- Secrets exposure through API responses, logs, or error messages
- SSRF vulnerabilities in webhook or external request handling
- Insecure handling of Vault tokens or credentials
- Cryptographic weaknesses in the shared-secret encryption flow
- Supply chain vulnerabilities in direct dependencies

**Out of scope:**
- Vulnerabilities in HashiCorp Vault itself (report to HashiCorp)
- Vulnerabilities requiring physical access to the server
- Social engineering attacks
- Findings from automated scanners without demonstrated impact

---

## Security Design

VaultLens implements several layers of defence:

- **Per-request token validation** — Every authenticated request validates the token against Vault's `/auth/token/lookup-self`
- **CSRF protection** — Double-submit cookie pattern on all state-changing requests
- **Content Security Policy** — Strict CSP headers via Helmet in production
- **Rate limiting** — All API endpoints are rate-limited
- **E2E encryption** — Shared secrets use OpenPGP; the decryption key never leaves the browser (URL fragment)
- **Input validation and path sanitisation** — All user-supplied Vault paths are encoded; file paths use `path.basename()`
- **SSRF blocklist** — Webhook destinations are validated against RFC-1918 and loopback ranges

---

## Acknowledgements

We thank security researchers who responsibly disclose vulnerabilities.

