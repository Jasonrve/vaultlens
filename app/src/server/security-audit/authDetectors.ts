import type {
  AuditResource,
  AuditFinding,
} from '../../shared/securityAudit.js';
import type { RuleView, Severity } from '../../shared/auditRules.js';
export const AUTH_DETECTORS = [
  'approle_privileged_policy',
  'approle_secret_id_uses',
  'approle_secret_id_ttl',
  'approle_secret_id_binding',
  'approle_token_ttl',
  'approle_periodic_token',
  'approle_cidr_review',
  'approle_compound',
  'jwt_privileged_policy',
  'jwt_audience',
  'jwt_bound_claims',
  'jwt_token_ttl',
  'jwt_broad_glob',
  'kubernetes_wildcard_name',
  'kubernetes_wildcard_namespace',
  'kubernetes_double_wildcard',
  'kubernetes_privileged_wildcard',
  'kubernetes_token_ttl',
  'kubernetes_restriction_review',
];
export const values = (v: unknown): string[] =>
  [
    ...new Set(
      (typeof v === 'string' ? v.split(',') : Array.isArray(v) ? v : [])
        .map((x) => String(x).trim())
        .filter(Boolean),
    ),
  ].sort();
export function seconds(v: unknown): number {
  if (v === undefined || v === null || v === '') return 0;
  if (typeof v === 'number' && Number.isInteger(v) && v >= 0) return v;
  if (typeof v !== 'string') throw new Error('Invalid duration');
  if (/^\d+$/.test(v)) return Number(v);
  if (!/^(?:\d+[smhd])+$/i.test(v)) throw new Error('Invalid duration');
  return [...v.toLowerCase().matchAll(/(\d+)([smhd])/g)].reduce(
    (n, m) => n + Number(m[1]) * { s: 1, m: 60, h: 3600, d: 86400 }[m[2]]!,
    0,
  );
}
export function globMatch(pattern: string, value: string): boolean {
  const tokens = pattern.match(/\[[^\]]+\]|\*|\?|[\s\S]/g) ?? [];
  let row = Array(value.length + 1).fill(false) as boolean[];
  row[0] = true;
  for (const token of tokens) {
    const next = Array(value.length + 1).fill(false) as boolean[];
    if (token === '*') {
      next[0] = row[0];
      for (let j = 1; j <= value.length; j++) next[j] = row[j] || next[j - 1];
    } else
      for (let j = 1; j <= value.length; j++) {
        let match = token === '?' || token === value[j - 1];
        if (token.startsWith('[') && token.endsWith(']')) {
          try {
            match = new RegExp('^' + token.replace(/^\[!/, '[^') + '$').test(
              value[j - 1],
            );
          } catch {
            match = false;
          }
        }
        next[j] = row[j - 1] && match;
      }
    row = next;
  }
  return row[value.length];
}
const record = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : {};
const flat = (v: unknown): string[] =>
  Array.isArray(v)
    ? v.flatMap(flat)
    : v && typeof v === 'object'
      ? Object.values(v).flatMap(flat)
      : [
          v === null
            ? 'None'
            : v === true
              ? 'True'
              : v === false
                ? 'False'
                : String(v),
        ];
export interface AuthContext {
  config: Record<string, unknown>;
  privilegeReasons?: Map<string, string[]>;
}
export function policyPrivilegeReasons(
  names: string[],
  context: AuthContext,
): Record<string, string[]> {
  const priv = record(context.config.privileged_policies);
  const privileged: Record<string, string[]> = {};
  for (const name of values(names)) {
    const reasons = [...(context.privilegeReasons?.get(name) ?? [])];
    if (
      values(priv.exact ?? ['root', 'vault-admins']).includes(name) ||
      values(priv.patterns).some((p) => globMatch(p, name))
    )
      reasons.push('configured_privileged_policy');
    if (reasons.length) privileged[name] = values(reasons);
  }
  return privileged;
}
export function evaluateAuth(
  rule: RuleView,
  resource: AuditResource,
  context: AuthContext,
): AuditFinding[] {
  if (resource.kind !== 'role') return [];
  const type = String(resource.data.auth_type);
  if (rule.detector.startsWith('approle_') && type !== 'approle') return [];
  if (rule.detector.startsWith('jwt_') && !['jwt', 'oidc'].includes(type))
    return [];
  if (rule.detector.startsWith('kubernetes_') && type !== 'kubernetes')
    return [];
  const m = resource.data,
    c = context.config;
  const app = record(c.approle),
    jwt = record(c.jwt),
    kube = record(c.kubernetes),
    threshold = record(c.thresholds);
  const assigned = values([
    ...values(m.token_policies),
    ...values(m.policies),
    ...(m.token_no_default_policy ? [] : ['default']),
  ]);
  const privileged = policyPrivilegeReasons(assigned, context);
  const hasPrivilege = Object.keys(privileged).length > 0;
  const output: AuditFinding[] = [];
  function emit(
    message: string,
    evidence: Record<string, unknown>,
    severity: Severity = rule.severity,
  ) {
    output.push({
      ruleId: rule.id,
      path: resource.path,
      title: message,
      evidence: JSON.stringify(evidence),
      recommendation: rule.remediation,
      severity,
    });
  }
  const ttl = () => {
    const token = seconds(m.token_ttl ?? m.ttl),
      max = seconds(m.token_max_ttl ?? m.max_ttl);
    const severity =
      token > seconds(threshold.token_ttl_high ?? '24h') ||
      max > seconds(threshold.token_max_ttl_high ?? '72h')
        ? 'high'
        : token > seconds(threshold.token_ttl_warning ?? '8h') ||
            max > seconds(threshold.token_max_ttl_warning ?? '24h')
          ? 'medium'
          : null;
    if (severity)
      emit(
        'Token lifetime exceeds configured threshold',
        { token_ttl_seconds: token, token_max_ttl_seconds: max },
        severity,
      );
  };
  const uses = Number(m.secret_id_num_uses ?? 0),
    secretTTL = seconds(m.secret_id_ttl);
  const names = values(m.bound_service_account_names),
    namespaces = values(m.bound_service_account_namespaces);
  const selector = m.bound_service_account_namespace_selector;
  const selectorPresent = !(
    selector == null ||
    selector === '' ||
    selector === '{}' ||
    (typeof selector === 'object' && Object.keys(selector).length === 0)
  );
  const wildcardName = names.includes('*'),
    wildcardNamespace = namespaces.includes('*') && !selectorPresent;
  const scope = {
    bound_service_account_names: names,
    bound_service_account_namespaces: namespaces,
  };
  switch (rule.detector) {
    case 'approle_privileged_policy':
    case 'jwt_privileged_policy':
      if (hasPrivilege)
        emit(
          'Role assigns privileged policies',
          { privileged_policies: privileged },
          'root' in privileged ? 'critical' : 'high',
        );
      break;
    case 'approle_secret_id_uses': {
      const warning = Number(app.secret_id_num_uses_warning ?? 100);
      if (uses === 0 || uses > warning)
        emit(
          uses === 0
            ? 'SecretIDs have unlimited uses'
            : 'SecretID reuse exceeds configured threshold',
          { secret_id_num_uses: uses, configured_warning_threshold: warning },
          uses === 0 ? 'medium' : 'low',
        );
      break;
    }
    case 'approle_secret_id_ttl': {
      const warning = seconds(app.secret_id_ttl_warning ?? '24h');
      if (secretTTL === 0 || secretTTL > warning)
        emit(
          secretTTL === 0
            ? 'Generated SecretIDs do not expire'
            : 'SecretID lifetime exceeds configured threshold',
          {
            secret_id_ttl_seconds: secretTTL,
            configured_warning_threshold_seconds: warning,
            privileged_policies: privileged,
          },
          secretTTL === 0 ? (hasPrivilege ? 'high' : 'medium') : 'low',
        );
      break;
    }
    case 'approle_secret_id_binding':
      if (m.bind_secret_id === false) {
        const cidrs = values(m.secret_id_bound_cidrs);
        emit(
          'SecretID is not required for AppRole login',
          { bind_secret_id: false, secret_id_bound_cidrs: cidrs },
          cidrs.length ? 'info' : 'medium',
        );
      }
      break;
    case 'approle_token_ttl':
    case 'jwt_token_ttl':
    case 'kubernetes_token_ttl':
      ttl();
      break;
    case 'approle_periodic_token': {
      const period = seconds(m.token_period ?? m.period),
        max = seconds(m.token_explicit_max_ttl);
      if (period > 0)
        emit(
          'AppRole issues renewable periodic tokens',
          {
            token_period_seconds: period,
            token_explicit_max_ttl_seconds: max,
            potentially_indefinite_renewal: max === 0,
            privileged_policies: privileged,
          },
          hasPrivilege && max === 0 ? 'high' : 'medium',
        );
      break;
    }
    case 'approle_cidr_review':
      if (
        hasPrivilege &&
        (app.require_cidr_for_privileged_roles ?? true) &&
        !values(m.token_bound_cidrs).length
      )
        emit('Privileged AppRole tokens are not CIDR-bound', {
          token_bound_cidrs: [],
          privileged_policies: privileged,
        });
      break;
    case 'approle_compound': {
      const weak = {
        bind_secret_id_disabled: m.bind_secret_id === false,
        secret_id_unlimited_uses: uses === 0,
        secret_id_non_expiring: secretTTL === 0,
      };
      if (
        hasPrivilege &&
        (weak.bind_secret_id_disabled ||
          (weak.secret_id_unlimited_uses && weak.secret_id_non_expiring))
      )
        emit(
          'Privileged AppRole combines weak SecretID controls',
          { privileged_policies: privileged, ...weak },
          weak.bind_secret_id_disabled ? 'critical' : 'high',
        );
      break;
    }
    case 'jwt_audience':
      if (
        (m.role_type ?? 'oidc') === 'jwt' &&
        !values(m.bound_audiences).length
      )
        emit(
          'JWT role has no bound audience',
          {
            role_type: 'jwt',
            bound_audiences: [],
            privileged_policies: privileged,
          },
          hasPrivilege ? 'high' : 'medium',
        );
      break;
    case 'jwt_bound_claims': {
      const claims = record(m.bound_claims),
        mount = resource.path
          .replace(/^auth\//, '')
          .replace(/\/role\/[^/]+$/, '');
      const byMount = Object.fromEntries(
        Object.entries(record(jwt.required_bound_claims_by_mount)).map(
          ([k, v]) => [k.replace(/^\/+|\/+$/g, ''), v],
        ),
      );
      const required = Array.isArray(byMount[mount])
          ? (byMount[mount] as string[])
          : [],
        missing = [
          ...new Set(required.filter((k) => !Object.hasOwn(claims, k))),
        ].sort();
      if (
        missing.length ||
        (hasPrivilege && !Object.keys(claims).length && !m.bound_subject)
      )
        emit(
          'JWT/OIDC role lacks configured identity claim restrictions',
          {
            bound_claims: Object.keys(claims).sort(),
            required_claims: required,
            missing_claims: missing,
            bound_subject: m.bound_subject ?? null,
            privileged_policies: privileged,
          },
          'medium',
        );
      break;
    }
    case 'jwt_broad_glob': {
      if ((m.bound_claims_type ?? 'string') !== 'glob') break;
      const claims = record(m.bound_claims),
        broad: Record<string, string[]> = {};
      for (const [key, value] of Object.entries(claims)) {
        const matches = values(
          flat(value).filter((v) =>
            values(jwt.broad_globs ?? ['*']).includes(v),
          ),
        );
        if (matches.length) broad[key] = matches;
      }
      if (!Object.keys(broad).length) break;
      const review = values(jwt.review_only_glob_claims ?? ['ref_protected']);
      const actionable = Object.fromEntries(
        Object.entries(broad).filter(([key]) => !review.includes(key)),
      );
      const narrowing = Object.keys(claims)
        .filter((k) => !Object.hasOwn(broad, k))
        .sort();
      if (!Object.keys(actionable).length && narrowing.length && !hasPrivilege)
        break;
      emit(
        'JWT bound claims contain configured broad globs',
        {
          broad_claims: broad,
          actionable_broad_claims: actionable,
          review_only_claims: Object.keys(broad)
            .filter((k) => review.includes(k))
            .sort(),
          narrowing_claims: narrowing,
          bound_claims: claims,
          privileged_policies: privileged,
        },
        hasPrivilege && Object.keys(actionable).length ? 'high' : 'medium',
      );
      break;
    }
    case 'kubernetes_wildcard_name':
      if (
        wildcardName &&
        namespaces.length &&
        namespaces.every((n) =>
          values(kube.allowed_wildcard_namespaces).includes(n),
        )
      )
        break;
      if (wildcardName && !wildcardNamespace)
        emit('All service account names are accepted', scope);
      break;
    case 'kubernetes_wildcard_namespace':
      if (wildcardNamespace && !wildcardName)
        emit('All Kubernetes namespaces are accepted', scope);
      break;
    case 'kubernetes_double_wildcard':
      if (wildcardName && wildcardNamespace && !hasPrivilege)
        emit('All service accounts in all namespaces can use the role', scope);
      break;
    case 'kubernetes_privileged_wildcard':
      if (hasPrivilege && (wildcardName || wildcardNamespace))
        emit(
          'Wildcard Kubernetes identity scope receives privileged policies',
          {
            ...scope,
            wildcard_name: wildcardName,
            wildcard_namespace: wildcardNamespace,
            privileged_policies: privileged,
          },
          wildcardName && wildcardNamespace ? 'critical' : 'high',
        );
      break;
    case 'kubernetes_restriction_review':
      if (!namespaces.length && !selectorPresent)
        emit('No recognized Kubernetes namespace restriction was collected', {
          bound_service_account_namespaces: [],
          namespace_selector: selector ?? null,
        });
      break;
  }
  return output;
}
