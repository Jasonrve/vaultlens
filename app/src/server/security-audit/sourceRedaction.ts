import { createHash } from 'node:crypto';
import type { AuditSnapshot } from '../../shared/securityAudit.js';

/** Copy before removal; first-pass analysis may still need the in-memory source. */
export function withoutPolicySource(snapshot: AuditSnapshot): AuditSnapshot {
  const result = structuredClone(snapshot);
  for (const resource of result.resources.filter(
    (resource) => resource.kind === 'policy',
  )) {
    if (typeof resource.data.hcl === 'string')
      resource.data.source_sha256 = createHash('sha256')
        .update(resource.data.hcl)
        .digest('hex');
    delete resource.data.hcl;
    resource.data.source_redacted = true;
  }
  return result;
}
