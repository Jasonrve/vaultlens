import type { AuditFinding } from '../../shared/securityAudit';
import AuditDisclosureIcon from './AuditDisclosureIcon';

export default function AuditFindingReason({
  finding,
}: {
  finding: AuditFinding;
}) {
  let data: Record<string, unknown> = {};
  try {
    const parsed: unknown = JSON.parse(finding.evidence);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed))
      data = parsed as Record<string, unknown>;
  } catch {
    /* Historical plain-text evidence uses the finding title. */
  }
  const path = typeof data.path === 'string' ? data.path : finding.policyPath;
  const sudo =
    finding.ruleId === 'POL-002' &&
    Array.isArray(data.capabilities) &&
    data.capabilities.includes('sudo');
  return (
    <section aria-label="Why this was flagged">
      <h4 className="text-sm font-semibold">Why this was flagged</h4>
      <p className="mt-1 text-sm leading-relaxed">
        {sudo ? (
          <>
            This policy grants <strong>sudo</strong>
            {path ? (
              <>
                {' '}
                on <code className="break-all">{path}</code>
              </>
            ) : (
              ' on the matched path'
            )}
            .
          </>
        ) : (
          <>
            {finding.title}
            {path && (
              <>
                {' '}
                — <code className="break-all">{path}</code>
              </>
            )}
          </>
        )}
      </p>
    </section>
  );
}

export function AuditFindingTechnicalDetails({
  evidence,
}: {
  evidence: string;
}) {
  let formatted = evidence;
  try {
    formatted = JSON.stringify(JSON.parse(evidence), null, 2);
  } catch {
    /* Preserve historical plain text. */
  }
  return (
    <details>
      <summary className="audit-disclosure-summary">
        <AuditDisclosureIcon level="detail" />
        <span>Technical details</span>
      </summary>
      <pre className="mt-2 overflow-auto whitespace-pre-wrap break-words rounded bg-gray-50 p-3 text-xs">
        {formatted}
      </pre>
    </details>
  );
}
