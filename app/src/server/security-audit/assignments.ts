import type { AuditResource } from '../../shared/securityAudit.js';
import { values } from './authDetectors.js';

export function assignedPolicies(resource: AuditResource): string[] {
  return values([
    ...values(resource.data.token_policies),
    ...values(resource.data.policies),
    ...(resource.kind === 'role' && !resource.data.token_no_default_policy
      ? ['default']
      : []),
  ]);
}
