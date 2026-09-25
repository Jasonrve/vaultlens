import type { AuditDetail, AuditControls } from '../../shared/securityAudit.js';
import { findingFingerprint } from './baseline.js';

/** Match by identity, never by array position: reports may reorder their findings. */
export function findingControls(
  detail: AuditDetail,
): (AuditControls['states'][number] | null)[] {
  const states = new Map<string, AuditControls['states'][number]>();
  const ambiguous = new Set<string>();
  for (const state of detail.snapshot?.controls?.states ?? []) {
    const previous = states.get(state.fingerprint);
    if (previous && JSON.stringify(previous) !== JSON.stringify(state))
      ambiguous.add(state.fingerprint);
    states.set(state.fingerprint, state);
  }
  return detail.findings.map((finding) => {
    const fingerprint = findingFingerprint(finding);
    return ambiguous.has(fingerprint)
      ? null
      : (states.get(fingerprint) ?? null);
  });
}
