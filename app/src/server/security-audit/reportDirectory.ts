import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { stringify } from 'yaml';
import type { AuditDetail } from '../../shared/securityAudit.js';
import { policyUsage } from '../../shared/policyUsage.js';
import { exportAudit } from './exporter.js';

/** Native report schema; filenames mirror the reference's human entry points. */
export function reportFiles(
  input: AuditDetail,
  redactPolicySource = false,
): Map<string, string> {
  const detail = JSON.parse(
    exportAudit(input, 'json', redactPolicySource),
  ) as AuditDetail;
  const snapshot = detail.snapshot!;
  if (snapshot.resources.length > 50000)
    throw new Error('Directory reports support up to 50000 resources');
  const files = new Map<string, string>();
  const yaml = (path: string, value: unknown) =>
    files.set(path, stringify(value, { lineWidth: 0 }));
  const usage = policyUsage(snapshot);
  const usageByKey = new Map(
    usage.map((row) => [JSON.stringify([row.namespace, row.name]), row]),
  );
  const findingsByKey = new Map<string, AuditDetail['findings']>();
  for (const finding of detail.findings) {
    const key = JSON.stringify([finding.namespace ?? '', finding.path]);
    const list = findingsByKey.get(key) ?? [];
    list.push(finding);
    findingsByKey.set(key, list);
  }
  const riskyPolicies: unknown[] = [],
    riskyRoles: unknown[] = [],
    unassigned: unknown[] = [];
  const resourceIndex: unknown[] = [];
  const warnings = [
    'No observed assignments does not prove a policy is unused. Review coverage before interpreting absence.',
    'Report schema is native VaultLens; Python machine-report compatibility is not implied.',
  ];
  for (const resource of snapshot.resources) {
    const namespace = resource.namespace ?? '';
    const key = JSON.stringify([namespace, resource.kind, resource.path]);
    const file = `objects/${createHash('sha256').update(key).digest('hex')}.yml`;
    if (files.has(file))
      throw new Error('Duplicate resource identity in report');
    const findings =
      findingsByKey.get(JSON.stringify([namespace, resource.path])) ?? [];
    const references =
      resource.kind === 'policy'
        ? (usageByKey.get(JSON.stringify([namespace, resource.data.name]))
            ?.references ?? [])
        : [];
    const entry = {
      namespace,
      kind: resource.kind,
      path: resource.path,
      file,
      finding_count: findings.length,
    };
    yaml(file, {
      resource,
      findings,
      ...(resource.kind === 'policy'
        ? {
            references,
            usage_status: references.length ? 'observed' : 'not_observed',
          }
        : {}),
    });
    resourceIndex.push(entry);
    if (
      findings.some((finding) =>
        ['critical', 'high'].includes(finding.severity),
      )
    ) {
      if (resource.kind === 'policy') {
        riskyPolicies.push(entry);
        if (!references.length) unassigned.push(entry);
      }
      if (resource.kind === 'role') riskyRoles.push(entry);
    }
  }
  const metadata = { format: 'vaultlens-report', version: 1, run: detail.run };
  yaml('summary.yml', {
    ...metadata,
    resources: snapshot.resources.length,
    findings: detail.findings.length,
    configuration: detail.configuration,
    refresh: snapshot.refresh ?? null,
  });
  yaml('coverage.yml', {
    collection_issues: snapshot.issues,
    analysis_issues: detail.configuration?.issues ?? [],
    imported_coverage: snapshot.importedCoverage ?? [],
    stage_results: snapshot.collection?.stageResults ?? [],
    warnings,
  });
  yaml('overview.yml', {
    ...metadata,
    warnings,
    indexes: {
      policies: 'indexes/risky-policies.yml',
      auth_roles: 'indexes/risky-auth-roles.yml',
      unassigned_dangerous_policies:
        'indexes/unassigned-dangerous-policies.yml',
      policy_usage: 'indexes/policy-usage.yml',
    },
    objects: resourceIndex,
  });
  yaml('indexes/risky-policies.yml', {
    threshold: 'high',
    policies: riskyPolicies,
  });
  yaml('indexes/risky-auth-roles.yml', {
    threshold: 'high',
    auth_roles: riskyRoles,
  });
  yaml('indexes/unassigned-dangerous-policies.yml', {
    usage_status: 'not_observed',
    warnings,
    policies: unassigned,
  });
  yaml('indexes/policy-usage.yml', { warnings, policies: usage });
  files.set('snapshot.json', exportAudit(detail, 'json'));
  const jsonl = exportAudit(detail, 'jsonl');
  files.set('report.jsonl', jsonl);
  files.set('machine/report.jsonl', jsonl);
  return files;
}

export function writeReportDirectory(
  detail: AuditDetail,
  destination: string,
  redactPolicySource = false,
): number {
  const files = reportFiles(detail, redactPolicySource),
    directory = resolve(destination);
  // mkdir without recursive refuses an existing directory before writing files.
  mkdirSync(directory, { mode: 0o700 });
  try {
    for (const [name, content] of files) {
      const path = join(directory, name);
      mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
      writeFileSync(path, content, { mode: 0o600, flag: 'wx' });
    }
  } catch (error) {
    rmSync(directory, { recursive: true, force: true });
    throw error;
  }
  return files.size;
}
