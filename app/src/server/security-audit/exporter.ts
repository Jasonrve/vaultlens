import { withoutPolicySource } from './sourceRedaction.js';
import { stringify } from 'yaml';
import type { AuditDetail } from '../../shared/securityAudit.js';
export const EXPORT_FORMATS = ['json', 'jsonl', 'yaml', 'csv'] as const;
export type ExportFormat = (typeof EXPORT_FORMATS)[number];
export function exportAudit(
  input: AuditDetail,
  format: ExportFormat,
  redactPolicySource = false,
): string {
  const detail =
    redactPolicySource && input.snapshot
      ? { ...input, snapshot: withoutPolicySource(input.snapshot) }
      : input;
  if (
    !detail.snapshot ||
    !['collected', 'completed', 'partial'].includes(detail.run.status)
  )
    throw new Error('Export requires a finished snapshot');
  if (format === 'json') return JSON.stringify(detail, null, 2) + '\n';
  if (format === 'yaml') return stringify(detail, { lineWidth: 0 });
  if (format === 'jsonl')
    return (
      [
        {
          type: 'metadata',
          run: detail.run,
          configuration: detail.configuration ?? null,
          controls: detail.snapshot.controls ?? null,
        },
        ...detail.snapshot.resources.map((resource) => ({
          type: 'resource',
          resource,
        })),
        ...detail.findings.map((finding) => ({ type: 'finding', finding })),
        ...detail.snapshot.issues.map((issue) => ({
          type: 'collection_issue',
          issue,
        })),
        ...(detail.configuration?.issues ?? []).map((issue) => ({
          type: 'analysis_issue',
          issue,
        })),
        ...(detail.snapshot.identity?.assignments ?? []).map((assignment) => ({
          type: 'identity_assignment',
          assignment,
        })),
      ]
        .map((record) => JSON.stringify(record))
        .join('\n') + '\n'
    );
  // Spreadsheet programs can execute untrusted policy names as formulas.
  const cell = (value: unknown) => {
    let text = value == null ? '' : String(value);
    if (/^[\s]*[=+@-]/.test(text) || /^[\t\r\n]/.test(text)) text = "'" + text;
    return '"' + text.replaceAll('"', '""') + '"';
  };
  const rows: unknown[][] = [
    [
      'run_id',
      'namespace',
      'rule_id',
      'severity',
      'object_path',
      'policy_path',
      'title',
      'evidence',
      'recommendation',
      'baseline_status',
      'suppressed',
      'gate',
      'exception_id',
    ],
  ];
  detail.findings.forEach((f, index) => {
    const state = detail.snapshot?.controls?.states[index];
    rows.push([
      detail.run.id,
      f.namespace || 'root',
      f.ruleId,
      f.severity,
      f.path,
      f.policyPath,
      f.title,
      f.evidence,
      f.recommendation,
      state?.baselineStatus,
      state?.suppressed,
      state?.gate,
      state?.exception?.id,
    ]);
  });
  return rows.map((row) => row.map(cell).join(',')).join('\r\n') + '\r\n';
}
