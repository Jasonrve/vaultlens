import type {
  AuditFinding,
  AuditResource,
} from '../../shared/securityAudit.js';
import type { RuleView, Severity } from '../../shared/auditRules.js';
import type { PolicyBlock } from './policyParser.js';
import { globMatch } from './authDetectors.js';
export const POLICY_DETECTORS = [
  'sensitive_management',
  'root_wildcard',
  'sudo_capability',
  'acl_policy_administration',
  'auth_mount_administration',
  'token_issuance',
  'broad_secret_path',
  'contextual_wildcard',
  'audit_device_administration',
  'mount_administration',
];
export const PRIVILEGE_SIGNALS = new Set([
  'POL-001',
  'POL-002',
  'POL-003',
  'POL-004',
  'TOKEN-005',
  'POL-008',
  'POL-009',
]);
const mutating = ['create', 'update', 'delete', 'patch'],
  granting = [...mutating, 'read', 'list', 'sudo'];
const trim = (s: string) => s.replace(/^\/+|\/+$/g, '');
export function vaultPatternMatches(pattern: string, path: string): boolean {
  // Segment wildcards and the terminal prefix glob can occur together.
  const expected = trim(pattern).split('/'),
    actual = trim(path).split('/');
  for (let i = 0; i < expected.length; i++) {
    const part = expected[i];
    if (part.endsWith('*') && i === expected.length - 1)
      return actual.slice(i).join('/').startsWith(part.slice(0, -1));
    if (actual[i] === undefined || (part !== '+' && part !== actual[i]))
      return false;
  }
  return expected.length === actual.length;
}
export function evaluatePolicy(
  rule: RuleView,
  resource: AuditResource,
  blocks: PolicyBlock[],
  mounts: AuditResource[],
): AuditFinding[] {
  const output: AuditFinding[] = [];
  const params = rule.parameters;
  const list = (key: string, fallback: string[]) =>
    Array.isArray(params[key])
      ? (params[key] as unknown[]).map(String)
      : fallback;
  const roots = ['*', '+'];
  const secretMount = (path: string) =>
    mounts
      .filter((m) => m.kind === 'secret-mount')
      .sort(
        (a, b) =>
          String(b.data.mount_path).length - String(a.data.mount_path).length,
      )
      .find((m) => {
        const prefix = trim(String(m.data.mount_path));
        return path === prefix || path.startsWith(prefix + '/');
      });
  for (const block of blocks) {
    const caps = [...new Set(block.capabilities)].sort(),
      path = block.path,
      normalized = trim(path);
    if (caps.includes('deny')) continue;
    const grants = caps.some((c) => granting.includes(c)),
      writes = caps.some((c) => mutating.includes(c));
    const emit = (
      evidence: Record<string, unknown>,
      severity: Severity = rule.severity,
    ) =>
      output.push({
        ruleId: rule.id,
        path: resource.path,
        title: rule.title,
        severity,
        evidence: JSON.stringify(evidence),
        recommendation: rule.remediation,
        policyPath: path,
        line: block.line,
        matchedBlock: block.source,
        attributes: block.attributes,
      });
    const base = { path, capabilities: caps };
    switch (rule.detector) {
      case 'sensitive_management': {
        // Global grants already have a dedicated finding (POL-001).
        if (roots.includes(normalized)) break;
        const type = String(params.mount_type);
        const operations = list(
          'operations',
          type === 'kv' ? ['delete', 'update'] : mutating,
        );
        if (!caps.some((c) => operations.includes(c))) break;
        const targets =
          type === 'identity'
            ? [{ mount: 'identity', type: 'identity' }]
            : mounts
                .filter(
                  (m) =>
                    m.kind === 'secret-mount' &&
                    m.data.type === type &&
                    (m.namespace ?? '') === (resource.namespace ?? '') &&
                    (type !== 'kv' ||
                      String(
                        (m.data.options as Record<string, unknown> | undefined)
                          ?.version,
                      ) === '2'),
                )
                .map((m) => ({ mount: trim(String(m.data.mount_path)), type }));
        for (const target of targets) {
          if (
            typeof params.required_suffix === 'string' &&
            !normalized.endsWith(String(params.required_suffix)) &&
            !vaultPatternMatches(
              path,
              target.mount + '/keys/__audit_probe__' + params.required_suffix,
            )
          )
            continue;
          const prefixes = list('prefixes', []).filter((prefix) => {
            if (
              type === 'kv' &&
              prefix === 'metadata' &&
              !caps.includes('delete')
            )
              return false;
            if (
              type === 'kv' &&
              prefix === 'destroy' &&
              !caps.includes('update')
            )
              return false;
            const endpoint = target.mount + '/' + prefix;
            return (
              normalized === endpoint ||
              normalized.startsWith(endpoint + '/') ||
              vaultPatternMatches(path, endpoint) ||
              vaultPatternMatches(path, endpoint + '/__audit_probe__')
            );
          });
          if (prefixes.length)
            emit({
              ...base,
              mount: target.mount,
              mount_type: type,
              management_scopes: prefixes,
            });
        }
        break;
      }
      case 'root_wildcard':
        if (list('root_paths', roots).includes(path) && grants)
          emit(base, writes || caps.includes('sudo') ? 'critical' : 'high');
        break;
      case 'sudo_capability':
        if (caps.includes('sudo') && !roots.includes(path)) {
          const relevant = list('root_protected_prefixes', []).some((p) =>
            path.startsWith(p),
          );
          emit(
            { ...base, known_root_protected_scope: relevant },
            relevant ? 'high' : 'medium',
          );
        }
        break;
      case 'acl_policy_administration': {
        if (!writes) break;
        const prefix = list('prefixes', [
          'sys/policy',
          'sys/policies/acl',
        ]).find((p) => path.startsWith(p + '/'));
        if (!prefix) break;
        const target = path.slice(prefix.length + 1),
          pattern = target.replaceAll('+', '*');
        const broad =
          roots.includes(target) ||
          globMatch(pattern, String(resource.data.name)) ||
          list('protected_names', ['root', 'default', 'vault-admins']).some(
            (p) => globMatch(pattern, p),
          );
        emit(
          { ...base, scope: broad ? 'broad_or_self' : 'scoped' },
          broad ? 'critical' : 'high',
        );
        break;
      }
      case 'auth_mount_administration': {
        const prefix = String(params.prefix ?? 'sys/auth');
        if (!writes || !path.startsWith(prefix)) break;
        const suffix = trim(path.slice(prefix.length)),
          broad = !suffix || roots.includes(suffix);
        emit(
          { ...base, scope: broad ? 'broad' : 'scoped' },
          broad ? 'critical' : 'high',
        );
        break;
      }
      case 'token_issuance': {
        if (!writes) break;
        const kind =
          path === 'auth/token/create'
            ? 'child'
            : path === 'auth/token/create-orphan'
              ? 'orphan'
              : path.startsWith('auth/token/create/')
                ? 'token_role_issuance'
                : path.startsWith('auth/token/roles')
                  ? 'token_role_administration'
                  : null;
        if (kind)
          emit(
            { ...base, issuance_kind: kind },
            kind === 'child' ? 'medium' : 'high',
          );
        break;
      }
      case 'broad_secret_path': {
        if (!grants) break;
        const mount = secretMount(normalized);
        if (
          mount &&
          list('excluded_mount_types', ['cubbyhole']).includes(
            String(mount.data.type),
          )
        )
          break;
        const mountPath = mount ? trim(String(mount.data.mount_path)) : null,
          relative = mountPath
            ? trim(normalized.slice(mountPath.length))
            : normalized;
        const broad =
          (!!mountPath &&
            list('broad_relative_paths', [
              '*',
              '+',
              'data/*',
              'metadata/*',
            ]).includes(relative)) ||
          normalized.startsWith('+/data/') ||
          ['+/data/*', '+/metadata/*'].includes(normalized);
        if (broad)
          emit(
            { ...base, secret_mount: mountPath, scope: relative },
            writes || caps.includes('read') || caps.includes('sudo')
              ? 'high'
              : 'medium',
          );
        break;
      }
      case 'contextual_wildcard': {
        if (!grants || roots.includes(normalized) || secretMount(normalized))
          break;
        const at = normalized
          .split('/')
          .findIndex((p) => p.includes('*') || p === '+');
        if (at >= 0 && at <= Number(params.maximum_static_prefix_segments ?? 1))
          emit(
            { ...base, wildcard_segment: at },
            writes || caps.includes('sudo') ? 'high' : 'medium',
          );
        break;
      }
      case 'audit_device_administration':
        if (
          writes &&
          list('paths', ['sys/audit', 'sys/audit/*']).some((p) =>
            vaultPatternMatches(p, normalized),
          ) &&
          !list('excluded_paths', []).some((p) =>
            vaultPatternMatches(p, normalized),
          )
        )
          emit(base);
        break;
      case 'mount_administration': {
        if (
          !writes ||
          !list('paths', ['sys/mounts', 'sys/mounts/*']).some((p) =>
            vaultPatternMatches(p, normalized),
          )
        )
          break;
        const suffix = trim(normalized.slice('sys/mounts'.length)),
          broad = !suffix || roots.includes(suffix);
        emit(
          { ...base, scope: broad ? 'broad' : 'scoped' },
          broad ? 'critical' : 'high',
        );
        break;
      }
    }
  }
  return output;
}
