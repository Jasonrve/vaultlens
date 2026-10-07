# Security Audit coverage and validation

This describes the shipped implementation, not full parity with another tool.
The web feature focuses on read-only configuration collection and assessment.

| Area | Implemented | Limits |
| --- | --- | --- |
| ACL policies | Literal parser, matched source/line evidence, dangerous capabilities and management paths | Not a full effective-permission evaluator |
| Authentication | AppRole, Kubernetes, JWT/OIDC and token checks; additional cloud role inventory | No cloud-provider-specific checks or live login verification |
| Identity | Entities, groups, aliases, direct/inherited relationships | No proof of credential possession or usable authentication |
| Secrets engines | Mount inventory, PKI role/issuer expiry, Transit configuration metadata, KV version | No secret values/private keys, no comprehensive engine configuration audit |
| Coverage | Namespace/stage gaps, rate limits, retries, checkpoints | Non-atomic collection; Enterprise namespace behavior uses synthetic validation |
| History | Immutable results/configuration, reanalysis, strict diff, selective refresh | Old native engine implementations are not retained |
| Controls | Exact exceptions, saved revisions, CLI/API baselines | No automated remediation |
| Reports | JSON/JSONL/YAML/CSV and linked ZIP/directory reports | Native schema; no claim of Python machine-report equivalence |
| CLI/import | Shared engine, schemas 2/3 observation import | No manifest application or CI deployment planner |

The synthetic auth/policy/Identity/relationship/reference corpora compare defined
cases against an earlier Python reference. They are regression evidence for those
cases, not exhaustive semantic equivalence. Test assertions cover negative cases,
namespace separation, incomplete inventory, redaction, transaction isolation,
malformed import, source evidence, and new domain checks.

The local lab validates the actual worker/API against a disposable Vault with
risky and bounded configurations. Automated tests also cover states that should
not be manufactured in the live lab, such as stale aliases and old key timestamps.
Large-scale performance and full Enterprise deployment remain unverified.
