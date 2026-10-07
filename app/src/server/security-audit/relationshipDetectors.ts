import { assignedPolicies } from './assignments.js';
import { policyPrivilegeReasons, type AuthContext } from './authDetectors.js';
import type {
  AuditFinding,
  AuditResource,
} from '../../shared/securityAudit.js';
import type { RuleView } from '../../shared/auditRules.js';
import type { PolicyBlock } from './policyParser.js';
import { vaultPatternMatches } from './policyDetectors.js';

export const RELATIONSHIP_DETECTORS = [
  'privileged_role_mutation',
  'token_role_escalation',
  'escalation_graph',
  'self_policy_escalation',
  'auth_mount_bootstrap',
  'policy_role_assignment_chain',
];
type Grant = { policy: string; block: PolicyBlock };
const strings = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.map(String)
    : typeof value === 'string'
      ? value
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
      : [];
const evidence = (grants: Grant[]) =>
  grants.map(({ policy, block }) => ({
    policy,
    path: block.path,
    capabilities: [...new Set(block.capabilities)].sort(),
  }));

/** Static observed-assignment chains; these do not execute login or mutation. */
export function evaluateRelationship(
  rule: RuleView,
  resource: AuditResource,
  documents: Map<string, PolicyBlock[]>,
  resources: AuditResource[],
  context: AuthContext,
  entityIds: Map<string, Set<string>>,
): AuditFinding[] {
  if (resource.kind !== 'role') return [];
  const names = assignedPolicies(resource);
  const grants: Grant[] = names.flatMap((policy) =>
    (documents.get(policy) ?? [])
      .filter(
        (block) =>
          !block.capabilities.includes('deny') &&
          block.capabilities.some((c) =>
            ['create', 'update', 'delete', 'patch'].includes(c),
          ),
      )
      .map((block) => ({ policy, block })),
  );
  const matches = (path: string) =>
    grants.filter((g) => vaultPatternMatches(g.block.path, path));
  const roleGrants = matches(resource.path);
  const authenticate = `authenticate through ${resource.path}`;
  const result: AuditFinding[] = [];
  const emit = (
    data: Record<string, unknown>,
    sources: Grant[],
    severity = rule.severity,
    related: NonNullable<AuditFinding['relatedObjects']> = [],
  ) =>
    result.push({
      ruleId: rule.id,
      path: resource.path,
      title: rule.title,
      severity,
      recommendation: rule.remediation,
      evidence: JSON.stringify(data),
      relatedObjects: [
        ...[...new Set(sources.map((g) => g.policy))].sort().map((name) => ({
          kind: 'policy',
          path: `sys/policies/acl/${name}`,
          name,
        })),
        ...related,
      ],
    });
  switch (rule.detector) {
    case 'privileged_role_mutation':
      for (const target of resources.filter(
        (r) =>
          r.kind === 'role' &&
          r.data.auth_type !== 'token' &&
          r.path !== resource.path,
      )) {
        const privileged = policyPrivilegeReasons(
          assignedPolicies(target),
          context,
        );
        const mutation = matches(target.path);
        if (!Object.keys(privileged).length || !mutation.length) continue;
        const shared = [...(entityIds.get(resource.path) ?? [])]
          .filter((id) => entityIds.get(target.path)?.has(id))
          .sort();
        emit(
          {
            confidence: shared.length
              ? 'observed_same_identity_role_association'
              : 'inferred_authentication_step',
            target_role: target.path,
            target_role_kind:
              (
                {
                  approle: 'approle',
                  jwt: 'jwt_role',
                  oidc: 'jwt_role',
                  kubernetes: 'kubernetes_role',
                } as Record<string, string>
              )[String(target.data.auth_type)] ?? 'auth_role',
            privileged_policies: privileged,
            shared_identity_entities: shared,
            mutation_grants: evidence(mutation),
            chain: [
              authenticate,
              `modify ${target.path}`,
              shared.length
                ? 'authenticate through the target role; the same canonical Identity entity has observed aliases for both AppRoles'
                : 'authenticate through the target role (not observed)',
              'receive the target privileged policies',
            ],
            missing_context: shared.length
              ? 'Shared AppRole Identity aliases prove an observed role association, but do not prove possession of a currently valid target SecretID'
              : 'No identity evidence proves the source principal can authenticate through the target role',
          },
          mutation,
          rule.severity,
          [
            {
              kind: 'role',
              path: target.path,
              name: String(target.data.name ?? target.path.split('/').pop()),
            },
            ...Object.keys(privileged)
              .sort()
              .map((name) => ({
                kind: 'policy',
                path: `sys/policies/acl/${name}`,
                name,
              })),
            ...shared.map((name) => ({
              kind: 'entity',
              path: `identity/entity/id/${name}`,
              name,
            })),
          ],
        );
      }
      break;
    case 'token_role_escalation':
      for (const target of resources.filter(
        (r) => r.kind === 'role' && r.data.auth_type === 'token',
      )) {
        const roleAdmin = matches(target.path);
        const issuancePath = target.path.replace('/roles/', '/create/');
        const issuance = matches(issuancePath);
        if (!roleAdmin.length || !issuance.length) continue;
        const privileged = policyPrivilegeReasons(
          strings(target.data.allowed_policies),
          context,
        );
        const scope = [
          ...new Set([
            ...strings(target.data.allowed_policies),
            ...strings(target.data.allowed_policies_glob),
          ]),
        ].sort();
        emit(
          {
            confidence: 'proven_capability_chain',
            token_role: target.path,
            issuance_path: issuancePath,
            role_administration_grants: evidence(roleAdmin),
            token_issuance_grants: evidence(issuance),
            current_allowed_policy_scope: scope,
            current_privileged_policies: privileged,
            chain: [
              authenticate,
              `modify token role ${target.path}`,
              `issue a token through ${issuancePath}`,
            ],
          },
          [...roleAdmin, ...issuance],
          Object.keys(privileged).length ? 'critical' : 'high',
          [
            {
              kind: 'role',
              path: target.path,
              name: String(target.data.name ?? target.path.split('/').pop()),
            },
            ...Object.keys(privileged)
              .sort()
              .map((name) => ({
                kind: 'policy',
                path: `sys/policies/acl/${name}`,
                name,
              })),
          ],
        );
      }
      break;
    case 'escalation_graph':
      if (roleGrants.length)
        emit(
          {
            confidence: 'proven_from_observed_assignment',
            role_path: resource.path,
            mutation_grants: evidence(roleGrants),
            chain: [
              authenticate,
              `modify the same role through ${[...new Set(roleGrants.map((g) => g.block.path))].sort().join(', ')}`,
              're-authenticate through the modified role',
            ],
          },
          roleGrants,
        );
      break;
    case 'self_policy_escalation':
      for (const name of names) {
        const own = grants.filter(
          (g) =>
            g.policy === name &&
            [`sys/policies/acl/${name}`, `sys/policy/${name}`].some((p) =>
              vaultPatternMatches(g.block.path, p),
            ),
        );
        if (own.length)
          emit(
            {
              confidence: 'proven_from_observed_assignment',
              assigned_policy: name,
              mutation_grants: evidence(own),
              chain: [
                authenticate,
                `receive policy ${name}`,
                `modify the ACL definition of ${name}`,
                're-authenticate with the expanded policy',
              ],
            },
            own,
          );
      }
      break;
    case 'auth_mount_bootstrap': {
      const mount = grants.filter(
        (g) =>
          g.block.path === 'sys/auth' ||
          vaultPatternMatches(g.block.path, 'sys/auth/__vault_audit_mount__'),
      );
      const config = grants.filter((g) =>
        [
          'auth/__vault_audit_mount__/config',
          'auth/__vault_audit_mount__/role/__vault_audit_role__',
        ].some((p) => vaultPatternMatches(g.block.path, p)),
      );
      if (mount.length && config.length)
        emit(
          {
            confidence: 'proven_capabilities_inferred_configuration',
            mount_administration_grants: evidence(mount),
            auth_configuration_grants: evidence(config),
            chain: [
              authenticate,
              'enable or replace an auth mount through sys/auth',
              'configure the new auth method or one of its roles',
              'authenticate through the configured method (not observed)',
            ],
          },
          [...mount, ...config],
        );
      break;
    }
    case 'policy_role_assignment_chain': {
      const policy = grants.filter((g) =>
        [
          'sys/policies/acl/__vault_audit_policy__',
          'sys/policy/__vault_audit_policy__',
        ].some((p) => vaultPatternMatches(g.block.path, p)),
      );
      if (policy.length && roleGrants.length)
        emit(
          {
            confidence: 'proven_from_observed_assignment',
            policy_administration_grants: evidence(policy),
            role_administration_grants: evidence(roleGrants),
            chain: [
              authenticate,
              'create or replace an ACL policy',
              `change policy assignments on ${resource.path}`,
              're-authenticate with the newly assigned policy',
            ],
          },
          [...policy, ...roleGrants],
        );
      break;
    }
  }
  return result;
}
