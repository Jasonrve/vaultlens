import type {
  AuditFinding,
  AuditResource,
} from '../../shared/securityAudit.js';
import type { RuleView } from '../../shared/auditRules.js';
import { assignedPolicies } from './assignments.js';
import {
  policyPrivilegeReasons,
  values,
  type AuthContext,
} from './authDetectors.js';

export function evaluateReference(
  rule: RuleView,
  resource: AuditResource,
  known: Set<string>,
  complete: boolean,
  context: AuthContext,
): AuditFinding[] {
  if (!complete || resource.kind !== 'role') return [];
  const missing = values([
    ...assignedPolicies(resource),
    ...(resource.data.auth_type === 'token'
      ? values(resource.data.allowed_policies)
      : []),
  ]).filter((name) => !known.has(name));
  if (!missing.length) return [];
  // Missing-name severity uses configured names, not inferred HCL privilege.
  const privileged = Object.keys(
    policyPrivilegeReasons(missing, { config: context.config }),
  ).sort();
  return [
    {
      ruleId: rule.id,
      path: resource.path,
      title: rule.title,
      recommendation: rule.remediation,
      severity: privileged.length ? 'high' : 'medium',
      evidence: JSON.stringify({
        missing_policies: missing,
        missing_policy_count: missing.length,
        configured_privileged_names: privileged,
      }),
      relatedObjects: missing.map((name) => ({
        kind: 'policy',
        path: `sys/policies/acl/${name}`,
        name,
      })),
    },
  ];
}
