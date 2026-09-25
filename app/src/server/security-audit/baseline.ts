import { snapshotNamespaces } from './namespaces.js';
import {
  exceptionMatches,
  validDate,
  type FindingException,
} from './exceptions.js';
import { createHash } from 'node:crypto';
import { parseDocument } from 'yaml';
import { canonical } from './diff.js';
import type { AuditDetail, AuditFinding } from '../../shared/securityAudit.js';
import type { RunConfiguration } from '../../shared/auditRules.js';

export interface AuditBaseline {
  version: 1;
  tool: 'vaultlens';
  namespaces?: string[];
  target: string;
  source_scan_id: string;
  config_hash: string;
  engine_version: string;
  fingerprints: string[];
}
export function findingFingerprint(finding: AuditFinding): string {
  let evidence: unknown = finding.evidence;
  try {
    evidence = JSON.parse(finding.evidence);
  } catch {
    /* Legacy plain text. */
  }
  return createHash('sha256')
    .update(
      canonical({
        namespace: finding.namespace ?? '',
        rule: finding.ruleId,
        path: finding.path,
        policy_path: finding.policyPath ?? null,
        evidence,
      }),
    )
    .digest('hex');
}
export function createBaseline(detail: AuditDetail): AuditBaseline {
  if (
    !detail.snapshot ||
    !detail.configuration ||
    !['completed', 'partial'].includes(detail.run.status)
  )
    throw new Error('Baseline requires a finished, analyzed snapshot');
  return {
    version: 1,
    tool: 'vaultlens',
    namespaces: snapshotNamespaces(detail.snapshot),
    target: detail.snapshot.target,
    source_scan_id: detail.run.id,
    config_hash: detail.configuration.fingerprint,
    engine_version: detail.configuration.engineVersion,
    fingerprints: [...new Set(detail.findings.map(findingFingerprint))].sort(),
  };
}
export function parseBaseline(source: string): AuditBaseline {
  if (Buffer.byteLength(source) > 1024 * 1024)
    throw new Error('Baseline exceeds 1 MiB');
  const document = parseDocument(source, { uniqueKeys: true });
  if (document.errors.length) throw new Error('Invalid baseline YAML');
  const raw = document.toJS({ maxAliasCount: 0 });
  if (
    !raw ||
    typeof raw !== 'object' ||
    Array.isArray(raw) ||
    raw.version !== 1 ||
    raw.tool !== 'vaultlens'
  )
    throw new Error('Expected a version 1 VaultLens baseline');
  const allowed = [
    'version',
    'tool',
    'target',
    'source_scan_id',
    'config_hash',
    'engine_version',
    'fingerprints',
    'namespaces',
  ];
  if (Object.keys(raw).some((k) => !allowed.includes(k)))
    throw new Error('Unknown baseline field');
  for (const key of [
    'target',
    'source_scan_id',
    'config_hash',
    'engine_version',
  ])
    if (typeof raw[key] !== 'string' || !raw[key])
      throw new Error(`Baseline requires ${key}`);
  if (
    !Array.isArray(raw.fingerprints) ||
    raw.fingerprints.some(
      (v: unknown) => typeof v !== 'string' || !/^[a-f0-9]{64}$/.test(v),
    )
  )
    throw new Error('Invalid baseline fingerprints');
  if (
    raw.namespaces !== undefined &&
    (!Array.isArray(raw.namespaces) ||
      raw.namespaces.some((v: unknown) => typeof v !== 'string'))
  )
    throw new Error('Invalid baseline namespaces');
  return raw as AuditBaseline;
}
export function applyBaseline(
  findings: AuditFinding[],
  configuration: RunConfiguration,
  target: string,
  baseline?: AuditBaseline,
  exceptions: FindingException[] = [],
  today = localDate(),
  namespaces: string[] = [''],
): import('../../shared/securityAudit.js').AuditControls {
  if (
    baseline &&
    (baseline.target !== target ||
      baseline.config_hash !== configuration.fingerprint ||
      baseline.engine_version !== configuration.engineVersion)
  )
    throw new Error(
      'Baseline target, configuration or engine version is incompatible',
    );
  if (
    baseline &&
    canonical([...(baseline.namespaces ?? [''])].sort()) !==
      canonical([...new Set(namespaces)].sort())
  )
    throw new Error('Baseline namespaces are incompatible');
  if (!validDate(today)) throw new Error('Invalid controls date');
  const active = exceptions.filter(
      (e) =>
        e.enabled !== false && (e.expires === 'never' || e.expires >= today),
    ),
    expired = exceptions.filter(
      (e) => e.enabled !== false && e.expires !== 'never' && e.expires < today,
    ),
    used = new Set<string>();
  const known = new Set(baseline?.fingerprints ?? []),
    current = new Set<string>();
  const states = findings.map((finding) => {
    const fingerprint = findingFingerprint(finding);
    current.add(fingerprint);
    const baselineStatus = baseline
      ? known.has(fingerprint)
        ? 'unchanged'
        : 'new'
      : null;
    const exception = active.find((e) => exceptionMatches(e, finding));
    if (exception) used.add(exception.id);
    return {
      fingerprint,
      baselineStatus,
      suppressed: !!exception,
      exception: exception ?? null,
      gate: !exception && baselineStatus !== 'unchanged',
    };
  });
  return {
    appliedOn: today,
    baseline: baseline ?? null,
    exceptionDefinitions: exceptions,
    states,
    exceptions: {
      configured: exceptions.length,
      active: active.length,
      expired,
      unused: active.filter((e) => !used.has(e.id)),
    },
    absentFingerprints: [...known].filter((f) => !current.has(f)).sort(),
  };
}

function localDate(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}
