import { stringify } from 'yaml';
import type { RuleView } from '../../shared/auditRules';

export const ttlDetectors = new Set([
  'approle_token_ttl',
  'jwt_token_ttl',
  'kubernetes_token_ttl',
]);
export const privilegedDetectors = new Set([
  'approle_privileged_policy',
  'jwt_privileged_policy',
  'approle_secret_id_ttl',
  'approle_periodic_token',
  'approle_cidr_review',
  'approle_compound',
  'jwt_audience',
  'jwt_bound_claims',
  'jwt_broad_glob',
  'kubernetes_privileged_wildcard',
  'privileged_role_mutation',
  'token_role_escalation',
]);
const examples: Record<string, string> = {
  root_wildcard:
    'path "*" {\n  capabilities = ["read", "list", "create", "update", "delete"]\n}',
  sudo_capability: 'path "sys/*" {\n  capabilities = ["read", "sudo"]\n}',
  acl_policy_administration:
    'path "sys/policies/acl/*" {\n  capabilities = ["create", "update"]\n}',
  auth_mount_administration:
    'path "sys/auth/*" {\n  capabilities = ["create", "update", "delete"]\n}',
  mount_administration:
    'path "sys/mounts/*" {\n  capabilities = ["create", "update", "delete"]\n}',
  approle_secret_id_uses: 'secret_id_num_uses = 0',
  approle_secret_id_ttl: 'secret_id_ttl = "48h"',
  approle_secret_id_binding:
    'bind_secret_id = false\nsecret_id_bound_cidrs = []',
  approle_periodic_token: 'token_period = "24h"\ntoken_explicit_max_ttl = 0',
  approle_cidr_review: 'token_policies = ["root"]\ntoken_bound_cidrs = []',
  approle_compound: 'token_policies = ["root"]\nbind_secret_id = false',
  approle_privileged_policy: 'token_policies = ["root"]',
  jwt_privileged_policy: 'token_policies = ["root"]',
  jwt_audience: 'bound_audiences = []',
  jwt_bound_claims: 'bound_claims = {}',
  jwt_broad_glob:
    'bound_claims_type = "glob"\nbound_claims = { "project_path" = "*" }',
  kubernetes_wildcard_name: 'bound_service_account_names = ["*"]',
  kubernetes_wildcard_namespace: 'bound_service_account_namespaces = ["*"]',
  kubernetes_double_wildcard:
    'bound_service_account_names = ["*"]\nbound_service_account_namespaces = ["*"]',
  kubernetes_privileged_wildcard:
    'bound_service_account_names = ["*"]\ntoken_policies = ["root"]',
};
export function checkExample(rule: RuleView) {
  if (rule.id === 'PKI-008') return {
    label: 'Example / short certificate lifetime',
    source: 'ttl: 1h\nmax_ttl: 12h\nno_store: false\n\n# Both TTLs are below the default 24h review threshold.\n# Actual issuance volume and tidy configuration require separate review.',
  };
  if (ttlDetectors.has(rule.detector))
    return {
      label: 'Example / role configuration',
      source: 'token_ttl     = "12h"\ntoken_max_ttl = "24h"',
    };
  if (examples[rule.detector])
    return {
      label: 'Example / resource configuration',
      source: examples[rule.detector],
    };
  // Show the real declarative inputs rather than inventing an offending resource.
  return {
    label: 'Technical reference / detector inputs',
    source: stringify({
      detector: rule.detector,
      object_types: rule.object_types,
      ...(Object.keys(rule.parameters).length
        ? { parameters: rule.parameters }
        : {}),
    }).trim(),
  };
}

/** Resource type is separate from the check's topic/category and stable ID. */
export function checkObjectTypes(rule: RuleView): string {
  const labels: Record<string, string> = {
    acl_policy: 'ACL policy',
    policy: 'ACL policy',
    token_role: 'Token role',
    approle: 'AppRole role',
    jwt_role: 'JWT/OIDC role',
    kubernetes_role: 'Kubernetes role',
    auth_role: 'Auth role',
    entity: 'Identity entity',
    group: 'Identity group',
    alias: 'Identity alias',
    'transit-key': 'Transit key',
    'pki-role': 'PKI role',
    'pki-issuer': 'PKI issuer',
  };
  return [
    ...new Set(
      rule.object_types.map(
        (type) => labels[type] ?? type.replace(/[_-]/g, ' '),
      ),
    ),
  ].join(' / ');
}
