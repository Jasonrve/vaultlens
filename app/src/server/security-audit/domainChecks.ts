import type {
  AuditFinding,
  AuditSnapshot,
  IdentityAnalysis,
} from '../../shared/securityAudit.js';
import type { RuleView } from '../../shared/auditRules.js';
import {
  values,
  seconds,
  globMatch,
  policyPrivilegeReasons,
  type AuthContext,
} from './authDetectors.js';
import { vaultPatternMatches } from './policyDetectors.js';
import { parsePolicy } from './policyParser.js';

export function evaluateDomain(
  rule: RuleView,
  snapshot: AuditSnapshot,
  identity: IdentityAnalysis,
  context: AuthContext,
): AuditFinding[] {
  const check = String(rule.parameters.check ?? rule.id);
  const result: AuditFinding[] = [];
  const now = Date.parse(snapshot.finishedAt ?? snapshot.startedAt);
  for (const resource of snapshot.resources) {
    const d = resource.data;
    const emit = (evidence: Record<string, unknown>) =>
      result.push({
        ruleId: rule.id,
        title: rule.title,
        severity: rule.severity,
        path: resource.path,
        recommendation: rule.remediation,
        evidence: JSON.stringify(evidence),
      });
    if (resource.kind === 'role' && d.auth_type === 'token') {
      const allowed = values(d.allowed_policies),
        globs = values(d.allowed_policies_glob),
        denied = values(d.disallowed_policies),
        denyGlobs = values(d.disallowed_policies_glob);
      const names = [
        ...new Set([
          ...allowed,
          ...snapshot.resources
            .filter(
              (r) =>
                r.kind === 'policy' &&
                globs.some((g) => globMatch(g, String(r.data.name))),
            )
            .map((r) => String(r.data.name)),
        ]),
      ].filter(
        (n) => !denied.includes(n) && !denyGlobs.some((g) => globMatch(g, n)),
      );
      const privileged = policyPrivilegeReasons(names, context);
      if (
        check === 'TOKEN-001' &&
        globs.some((g) => g.includes('*') || g.includes('?'))
      )
        emit({
          allowed_policies_glob: globs,
          disallowed_policies: denied,
          disallowed_policies_glob: denyGlobs,
          scope:
            'Configured issuance patterns; exclusions and caller permissions still apply',
        });
      if (check === 'TOKEN-002' && Object.keys(privileged).length)
        emit({
          privileged_policies: privileged,
          scope:
            'Observed allowed policy names after exclusions; not proof of token issuance',
        });
      const period = seconds(d.token_period ?? d.period),
        max = seconds(d.token_explicit_max_ttl ?? d.explicit_max_ttl);
      if (check === 'TOKEN-003' && period > 0 && max === 0)
        emit({ period_seconds: period, explicit_max_ttl_seconds: max });
      if (
        check === 'TOKEN-004' &&
        d.orphan === true &&
        Object.keys(privileged).length &&
        ((period > 0 && max === 0) || max > Number(rule.parameters.max_seconds))
      )
        emit({
          orphan: true,
          period_seconds: period,
          explicit_max_ttl_seconds: max,
          privileged_policies: privileged,
        });
    }
    if (['entity', 'group'].includes(resource.kind)) {
      const assignments = identity.assignments.filter(
        (a) => a.subjectPath === resource.path,
      );
      const privileged = assignments.filter(
        (a) => Object.keys(policyPrivilegeReasons([a.policy], context)).length,
      );
      if (check === 'IDENTITY-001' && privileged.length)
        emit({
          disabled: d.disabled === true,
          assignments: privileged,
          scope:
            'Observed policy assignment, not proof of usable authentication',
        });
      if (check === 'IDENTITY-002') {
        const groups = [
          ...new Set(
            assignments
              .map((a) => a.sourcePath)
              .filter((p) => p.startsWith('identity/group/')),
          ),
        ];
        const grants = [];
        for (const name of new Set(assignments.map((a) => a.policy))) {
          const policy = snapshot.resources.find(
            (r) => r.kind === 'policy' && r.data.name === name,
          );
          if (typeof policy?.data.hcl !== 'string') continue;
          try {
            for (const block of parsePolicy(policy.data.hcl)) {
              if (
                block.capabilities.includes('deny') ||
                !block.capabilities.some((c) =>
                  ['create', 'update', 'patch'].includes(c),
                )
              )
                continue;
              for (const group of groups)
                if (vaultPatternMatches(block.path, group))
                  grants.push({ policy: name, policy_path: block.path, group });
            }
          } catch {
            /* Parser coverage is reported by the engine. */
          }
        }
        if (grants.length)
          emit({
            grants,
            scope:
              'Potential membership mutation from assigned policy blocks; effective ACL precedence and authentication require review',
          });
      }
    }
    if (
      check === 'IDENTITY-003' &&
      resource.kind === 'alias' &&
      typeof d.mount_accessor === 'string'
    ) {
      const complete = snapshot.checkpoint?.completedStages?.some(
        (s) =>
          s.stage === 'Auth mounts and roles' &&
          s.namespace === (resource.namespace ?? ''),
      );
      if (
        complete &&
        !snapshot.issues.some((i) => i.path === 'sys/auth') &&
        !snapshot.resources.some(
          (r) =>
            r.kind === 'auth-mount' && r.data.accessor === d.mount_accessor,
        )
      )
        emit({
          mount_accessor: d.mount_accessor,
          scope:
            'Accessor absent from the complete observed auth mount inventory',
        });
    }
    if (resource.kind === 'pki-role') {
      if (check === 'PKI-008') {
        const threshold = seconds((context.config.thresholds as Record<string, unknown> | undefined)?.certificate_ttl_minimum ?? '24h');
        const shortFields = ['ttl', 'max_ttl'].filter(field => seconds(d[field]) > 0 && seconds(d[field]) < threshold);
        if (shortFields.length) emit({
          ttl_seconds: seconds(d.ttl),
          max_ttl_seconds: seconds(d.max_ttl),
          minimum_ttl_seconds: threshold,
          below_threshold_fields: shortFields,
          certificate_storage: d.no_store === true ? 'disabled' : d.no_store === false ? 'enabled' : 'unknown',
          scope: 'Configured role TTL only; requested certificate TTLs, issuance volume and tidy configuration are not evaluated',
        });
      }
      if (check === 'PKI-001' && d.allow_any_name === true)
        emit({ allow_any_name: true });
      if (
        check === 'PKI-002' &&
        (values(d.allowed_domains).some(
          (x) => x === '*' || x.startsWith('*.'),
        ) ||
          d.allow_glob_domains === true ||
          d.allow_subdomains === true)
      )
        emit({
          allowed_domains: d.allowed_domains,
          allow_glob_domains: d.allow_glob_domains,
          allow_subdomains: d.allow_subdomains,
        });
      if (
        check === 'PKI-003' &&
        seconds(d.max_ttl) > Number(rule.parameters.max_seconds)
      )
        emit({
          max_ttl_seconds: seconds(d.max_ttl),
          threshold_seconds: rule.parameters.max_seconds,
        });
      if (
        check === 'PKI-004' &&
        ((d.key_type === 'rsa' &&
          Number(d.key_bits) > 0 &&
          Number(d.key_bits) < 2048) ||
          (d.key_type === 'ec' &&
            Number(d.key_bits) > 0 &&
            Number(d.key_bits) < 256))
      )
        emit({ key_type: d.key_type, key_bits: d.key_bits });
    }
    if (
      check === 'PKI-005' &&
      resource.kind === 'pki-issuer' &&
      typeof d.not_after === 'number'
    ) {
      const expires = d.not_after;
      if (expires - now < Number(rule.parameters.days) * 86400000)
        emit({
          expires_at: new Date(expires).toISOString(),
          evaluated_at: new Date(now).toISOString(),
          days_remaining: Math.floor((expires - now) / 86400000),
        });
    }
    if (resource.kind === 'transit-key') {
      if (
        check === 'TRANSIT-001' &&
        (d.exportable === true || d.allow_plaintext_backup === true)
      )
        emit({
          exportable: d.exportable,
          allow_plaintext_backup: d.allow_plaintext_backup,
        });
      if (check === 'TRANSIT-002' && d.deletion_allowed === true)
        emit({ deletion_allowed: true });
      if (
        check === 'TRANSIT-003' &&
        typeof d.latest_version_created_at === 'number' &&
        now - d.latest_version_created_at * 1000 >
          Number(rule.parameters.days) * 86400000
      )
        emit({
          latest_version: d.latest_version,
          latest_version_created_at: d.latest_version_created_at,
          auto_rotate_period: d.auto_rotate_period,
          threshold_days: rule.parameters.days,
          evaluated_at: new Date(now).toISOString(),
        });
    }
  }
  return result;
}
