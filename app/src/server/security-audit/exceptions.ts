import { canonicalCheckId } from '../../shared/auditCheckIds.js';
import { parseDocument } from 'yaml';
import { globMatch } from './authDetectors.js';
import type { AuditFinding } from '../../shared/securityAudit.js';
export type FindingException =
  import('../../shared/securityAudit.js').AuditException;
export function validDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value))
    return false;
  const date = new Date(value + 'T00:00:00Z');
  return (
    Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
  );
}
export function parseExceptions(
  source: string,
  ruleIds: Set<string>,
): FindingException[] {
  if (Buffer.byteLength(source) > 256 * 1024)
    throw new Error('Exceptions exceed 256 KiB');
  const document = parseDocument(source, { uniqueKeys: true });
  if (document.errors.length) throw new Error('Invalid exceptions YAML');
  const raw = document.toJS({ maxAliasCount: 0 });
  if (
    !raw ||
    typeof raw !== 'object' ||
    Array.isArray(raw) ||
    raw.version !== 1 ||
    Object.keys(raw).some((k) => !['version', 'exceptions'].includes(k))
  )
    throw new Error('Expected version 1 exceptions');
  const entries = raw.exceptions ?? [];
  if (!Array.isArray(entries) || entries.length > 1000)
    throw new Error('Expected at most 1000 exceptions');
  const seen = new Set<string>();
  return entries.map((entry, index) => {
    if (
      !entry ||
      typeof entry !== 'object' ||
      Array.isArray(entry) ||
      Object.keys(entry).some(
        (k) =>
          ![
            'name',
            'enabled',
            'builtin',
            'object_type',
            'id',
            'rule_id',
            'namespace',
            'object_path',
            'policy_path',
            'owner',
            'reason',
            'expires',
            'match',
          ].includes(k),
      )
    )
      throw new Error(`Invalid exception ${index}`);
    if (entry.enabled !== undefined && typeof entry.enabled !== 'boolean')
      throw new Error('Invalid enabled state');
    if (entry.builtin !== undefined && typeof entry.builtin !== 'boolean')
      throw new Error('Invalid preset state');
    if (
      entry.name !== undefined &&
      (typeof entry.name !== 'string' || entry.name.length > 200)
    )
      throw new Error('Invalid exception name');
    if (
      entry.object_type !== undefined &&
      !['policy', 'token', 'auth-role', 'entity', 'group', 'any'].includes(
        entry.object_type,
      )
    )
      throw new Error('Invalid object type');
    if (entry.object_type === 'token' && entry.enabled !== false)
      throw new Error(
        'Individual token collection is not supported. Token presets must remain disabled.',
      );
    if (
      entry.rule_id === '*' &&
      (!entry.object_type || entry.object_type === 'any')
    )
      throw new Error('All checks requires a specific object type');
    if (entry.match !== undefined && !['exact', 'glob'].includes(entry.match))
      throw new Error('Invalid exception match mode');
    for (const field of [
      'id',
      'rule_id',
      'namespace',
      'object_path',
      'owner',
      'reason',
    ]) {
      if (
        field === 'namespace' &&
        entry.match === 'exact' &&
        entry[field] === ''
      )
        continue;
      if (typeof entry[field] !== 'string' || !entry[field].trim())
        throw new Error(`Exception ${index} requires ${field}`);
      entry[field] = entry[field].trim();
    }
    if (seen.has(entry.id))
      throw new Error(`Duplicate exception id: ${entry.id}`);
    seen.add(entry.id);
    entry.rule_id = canonicalCheckId(entry.rule_id);
    if (entry.rule_id !== '*' && !ruleIds.has(entry.rule_id))
      throw new Error(`Unknown exception rule: ${entry.rule_id}`);
    if (entry.expires !== 'never' && !validDate(entry.expires))
      throw new Error('Exception expires must be YYYY-MM-DD');
    if (entry.policy_path !== undefined && entry.policy_path !== null) {
      if (typeof entry.policy_path !== 'string' || !entry.policy_path.trim())
        throw new Error('Invalid exception policy_path');
      entry.policy_path = entry.policy_path.trim();
    } else delete entry.policy_path;
    return entry as FindingException;
  });
}
export function exceptionMatches(
  entry: FindingException,
  finding: AuditFinding,
): boolean {
  if (entry.enabled === false) return false;
  const patterns: Record<string, RegExp> = {
    policy: /^sys\/policies\/acl\//,
    'auth-role': /^auth\/.+\/roles?\//,
    entity: /^identity\/entity\//,
    group: /^identity\/group\//,
  };
  if (entry.object_type === 'token') return false;
  if (
    entry.object_type &&
    patterns[entry.object_type] &&
    !patterns[entry.object_type].test(finding.path)
  )
    return false;
  if (entry.match === 'exact')
    return (
      (entry.rule_id === '*' || canonicalCheckId(entry.rule_id) === canonicalCheckId(finding.ruleId)) &&
      entry.namespace === (finding.namespace ?? '') &&
      entry.object_path === finding.path &&
      (entry.policy_path === undefined ||
        entry.policy_path === finding.policyPath)
    );
  return (
    (entry.rule_id === '*' || canonicalCheckId(entry.rule_id) === canonicalCheckId(finding.ruleId)) &&
    globMatch(entry.namespace, finding.namespace || 'root') &&
    globMatch(entry.object_path, finding.path) &&
    (entry.policy_path === undefined ||
      (finding.policyPath !== undefined &&
        globMatch(entry.policy_path, finding.policyPath)))
  );
}
