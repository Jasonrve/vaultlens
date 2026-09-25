import { evaluateDomain } from './domainChecks.js';
import { snapshotNamespaces } from './namespaces.js';
import { evaluateReference } from './referenceDetector.js';
import { analyzeIdentity, roleEntityIds } from './identity.js';
import {
  RELATIONSHIP_DETECTORS,
  evaluateRelationship,
} from './relationshipDetectors.js';
import type { PolicyBlock } from './policyParser.js';
import { parsePolicy } from './policyParser.js';
import {
  POLICY_DETECTORS,
  PRIVILEGE_SIGNALS,
  evaluatePolicy,
} from './policyDetectors.js';
import { AUTH_DETECTORS, evaluateAuth } from './authDetectors.js';
import {
  catalog,
  parseConfig,
  settingsFingerprint,
  SUPPORTED_DETECTORS,
} from './catalog.js';
import type {
  RuleSettings,
  RunConfiguration,
} from '../../shared/auditRules.js';
import type {
  AuditSnapshot,
  AuditFinding,
} from '../../shared/securityAudit.js';
export const ENGINE_VERSION = '16';
export const RULES = [
  { id: 'assignment.root', title: 'Root policy assigned to a principal' },
  { id: 'assignment.missing-policy', title: 'Assigned policy does not exist' },
  {
    id: 'approle.unbound-login',
    title: 'AppRole login has no SecretID or CIDR restriction',
  },
  {
    id: 'kubernetes.unbounded-subject',
    title: 'Kubernetes role accepts all service accounts and namespaces',
  },
];
const strings = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((s): s is string => typeof s === 'string') : [];
export function analyze(snapshot: AuditSnapshot): AuditFinding[] {
  const findings: AuditFinding[] = [];
  const policies = new Set(
    snapshot.resources
      .filter((r) => r.kind === 'policy')
      .map((r) => String(r.data.name)),
  );
  policies.add('root');
  for (const r of snapshot.resources) {
    if (!['role', 'entity', 'group'].includes(r.kind)) continue;
    const add = (
      ruleId: string,
      title: string,
      evidence: string,
      recommendation: string,
      severity: 'high' | 'medium' = 'high',
    ) =>
      findings.push({
        ruleId,
        severity,
        path: r.path,
        title,
        evidence,
        recommendation,
      });
    const assigned = [
      ...new Set([
        ...strings(r.data.token_policies),
        ...strings(r.data.policies),
      ]),
    ];
    if (assigned.includes('root'))
      add(
        'assignment.root',
        'Root policy assignment',
        'Assigned policies include root. This is a configuration finding, not proof that this auth method can issue a root token.',
        'Review the assignment and replace it with explicit least-privilege policies.',
      );
    if (snapshot.policiesComplete)
      for (const name of assigned) {
        if (!policies.has(name))
          add(
            'assignment.missing-policy',
            'Assigned policy is missing',
            `Policy ${name} was not found in the complete policy inventory.`,
            'Correct the policy name or restore the intended policy.',
            'medium',
          );
      }
    if (
      r.data.auth_type === 'approle' &&
      r.data.bind_secret_id === false &&
      strings(r.data.secret_id_bound_cidrs).length === 0 &&
      strings(r.data.token_bound_cidrs).length === 0
    ) {
      add(
        'approle.unbound-login',
        'AppRole login is not bound to a SecretID or CIDR',
        'bind_secret_id=false; no SecretID or token CIDR restrictions.',
        'Require SecretID authentication or define reviewed network restrictions.',
      );
    }
    if (
      r.data.auth_type === 'kubernetes' &&
      strings(r.data.bound_service_account_names).includes('*') &&
      strings(r.data.bound_service_account_namespaces).includes('*')
    ) {
      add(
        'kubernetes.unbounded-subject',
        'Kubernetes role accepts all service accounts and namespaces',
        'Both service-account and namespace bindings contain *.',
        'Bind this role to the service accounts and namespaces that need its policies.',
      );
    }
  }
  return findings.sort(
    (a, b) => a.path.localeCompare(b.path) || a.ruleId.localeCompare(b.ruleId),
  );
}

// Run through a versioned catalog; unknown implementation coverage is explicit.
function executeScoped(
  snapshot: AuditSnapshot,
  settings: RuleSettings,
): {
  findings: AuditFinding[];
  configuration: RunConfiguration;
  identity: import('../../shared/securityAudit.js').IdentityAnalysis;
} {
  const pinned = (settings as RunConfiguration).catalog;
  const definitions = (pinned ?? catalog(settings)).map((rule) => ({
    ...rule,
    supported: SUPPORTED_DETECTORS.includes(rule.detector),
  }));
  const config = parseConfig(
    settings.configYaml,
    new Set(definitions.map((r) => r.id)),
  );
  const legacy = analyze(snapshot);
  const issues: { path: string; reason: string }[] = [];

  if (!snapshot.policiesComplete)
    issues.push({
      path: 'sys/policies/acl',
      reason:
        'Policy inventory is incomplete; privilege and reference analysis may be incomplete',
    });
  const documents = new Map<string, PolicyBlock[]>();
  const privilegeReasons = new Map<string, string[]>();
  const policyResults = new Map<string, AuditFinding[]>();
  const mounts = snapshot.resources.filter((r) => r.kind === 'secret-mount');
  // Privilege signals must be evaluated even when their findings are disabled.
  for (const resource of snapshot.resources.filter(
    (r) => r.kind === 'policy',
  )) {
    try {
      if (typeof resource.data.hcl !== 'string')
        throw new Error('Policy source is unavailable');
      const blocks = parsePolicy(resource.data.hcl);
      documents.set(String(resource.data.name), blocks);
      for (const rule of definitions.filter(
        (r) =>
          POLICY_DETECTORS.includes(r.detector) &&
          (r.active || PRIVILEGE_SIGNALS.has(r.id)),
      )) {
        const findings = evaluatePolicy(rule, resource, blocks, mounts);
        policyResults.set(rule.id, [
          ...(policyResults.get(rule.id) ?? []),
          ...findings,
        ]);
        if (
          PRIVILEGE_SIGNALS.has(rule.id) &&
          findings.some((f) => ['critical', 'high'].includes(f.severity))
        ) {
          const name = String(resource.data.name);
          privilegeReasons.set(name, [
            ...(privilegeReasons.get(name) ?? []),
            rule.id,
          ]);
        }
      }
    } catch (error) {
      issues.push({
        path: resource.path,
        reason:
          error instanceof Error ? error.message : 'Policy parsing failed',
      });
    }
  }

  for (const mount of mounts) {
    const prefix =
      mount.data.type === 'pki'
        ? 'PKI-'
        : mount.data.type === 'transit'
          ? 'TRANSIT-'
          : null;
    if (
      prefix &&
      definitions.some(
        (r) =>
          r.active &&
          r.detector === 'domain_configuration' &&
          r.object_types.some(type => type.startsWith(prefix === 'PKI-' ? 'pki-' : 'transit-')),
      ) &&
      mount.data.audit_config_collected !== true
    )
      issues.push({
        path: mount.path,
        reason:
          'Snapshot lacks engine configuration collection metadata. Collect a fresh snapshot to evaluate ' +
          prefix +
          ' configuration checks.',
      });
  }
  const knownPolicies = new Set([
    'root',
    ...snapshot.resources
      .filter((r) => r.kind === 'policy')
      .map((r) => String(r.data.name)),
  ]);
  const identity = analyzeIdentity(
    snapshot.resources,
    snapshot.namespaceAliasCompleteness?.[snapshot.namespaces?.[0] ?? ''] ===
      true,
  );
  issues.push(...identity.issues);
  const entityIds = roleEntityIds(snapshot.resources);
  const resourcesByPath = new Map(snapshot.resources.map((r) => [r.path, r]));
  const bindings: Record<string, string> = {
    native_root_assignment: 'assignment.root',
    native_unbound_approle: 'approle.unbound-login',
    kubernetes_double_wildcard: 'kubernetes.unbounded-subject',
  };
  const findings: AuditFinding[] = [];

  for (const rule of definitions.filter((r) => r.active)) {
    if (!rule.supported) {
      issues.push({
        path: `rules/${rule.id}`,
        reason: `Detector ${rule.detector} has not been ported yet`,
      });
      continue;
    }
    let candidates: AuditFinding[] = [];
    if (POLICY_DETECTORS.includes(rule.detector))
      candidates = policyResults.get(rule.id) ?? [];
    else if (rule.detector === 'domain_configuration')
      candidates = evaluateDomain(rule, snapshot, identity, {
        config: config.raw,
        privilegeReasons,
      });
    else if (rule.detector === 'missing_policy_reference') {
      candidates = snapshot.resources.flatMap((resource) =>
        evaluateReference(
          rule,
          resource,
          knownPolicies,
          snapshot.policiesComplete,
          { config: config.raw },
        ),
      );
    } else if (RELATIONSHIP_DETECTORS.includes(rule.detector)) {
      candidates = snapshot.resources.flatMap((resource) =>
        evaluateRelationship(
          rule,
          resource,
          documents,
          snapshot.resources,
          { config: config.raw, privilegeReasons },
          entityIds,
        ),
      );
    } else if (AUTH_DETECTORS.includes(rule.detector)) {
      for (const resource of snapshot.resources)
        candidates.push(
          ...evaluateAuth(rule, resource, {
            config: config.raw,
            privilegeReasons,
          }),
        );
    } else if (rule.detector === 'field_compare') {
      const { field, operator, value } = rule.parameters;
      for (const resource of snapshot.resources) {
        const type =
          resource.kind === 'role'
            ? (
                {
                  approle: 'approle',
                  kubernetes: 'kubernetes_role',
                  jwt: 'jwt_role',
                  oidc: 'jwt_role',
                  token: 'token_role',
                } as Record<string, string>
              )[String(resource.data.auth_type)]
            : resource.kind === 'policy'
              ? 'acl_policy'
              : resource.kind;
        if (
          !rule.object_types.includes(type) &&
          !rule.object_types.includes(resource.kind)
        )
          continue;
        const actual = resource.data[String(field)];
        const matched =
          operator === 'missing'
            ? actual === undefined || actual === null
            : operator === 'equals'
              ? actual === value
              : operator === 'contains'
                ? Array.isArray(actual) && actual.includes(value)
                : typeof actual === 'number' && actual > Number(value);
        if (matched)
          candidates.push({
            ruleId: rule.id,
            path: resource.path,
            severity: rule.effectiveSeverity,
            title: rule.title,
            evidence: JSON.stringify({
              field,
              operator,
              expected: value,
              actual: actual ?? null,
            }),
            recommendation: rule.remediation,
          });
      }
    } else
      candidates = legacy.filter((f) => f.ruleId === bindings[rule.detector]);
    findings.push(
      ...candidates
        .filter((f) => {
          const resource = resourcesByPath.get(f.path);
          if (!resource) return false;
          const type =
            resource.kind === 'role'
              ? (
                  {
                    approle: 'approle',
                    kubernetes: 'kubernetes_role',
                    jwt: 'jwt_role',
                    oidc: 'jwt_role',
                    token: 'token_role',
                  } as Record<string, string>
                )[String(resource.data.auth_type)]
              : resource.kind === 'policy'
                ? 'acl_policy'
                : resource.kind;
          return (
            rule.object_types.includes(type) ||
            rule.object_types.includes(resource.kind) ||
            (resource.kind === 'role' &&
              rule.object_types.includes('auth_role'))
          );
        })
        .map((f) => ({
          ...f,
          ruleId: rule.id,
          title: rule.title,
          recommendation: rule.remediation,
          severity: config.overrides[rule.id]?.severity ?? f.severity,
        })),
    );
  }
  return {
    identity,
    findings,
    configuration: {
      ...settings,
      engineVersion: ENGINE_VERSION,
      catalog: definitions,
      fingerprint: settingsFingerprint(settings, definitions),
      issues,
    },
  };
}

export function execute(
  snapshot: AuditSnapshot,
  settings: RuleSettings,
): ReturnType<typeof executeScoped> {
  const namespaces = snapshotNamespaces(snapshot);
  if (namespaces.length === 1 && namespaces[0] === '')
    return executeScoped(snapshot, settings);
  const results = namespaces.map((namespace) => {
    const result = executeScoped(
      {
        ...snapshot,
        namespaces: [namespace],
        resources: snapshot.resources.filter(
          (resource) => (resource.namespace ?? '') === namespace,
        ),
        policiesComplete:
          snapshot.namespacePolicyCompleteness?.[namespace] ??
          snapshot.policiesComplete,
      },
      settings,
    );
    const qualify = (issue: { path: string; reason: string }) => ({
      ...issue,
      namespace,
      path: namespace ? `${namespace}:${issue.path}` : issue.path,
    });
    return {
      ...result,
      findings: result.findings.map((finding) => ({ ...finding, namespace })),
      configuration: {
        ...result.configuration,
        issues: result.configuration.issues.map(qualify),
      },
      identity: {
        ...result.identity,
        assignments: result.identity.assignments.map((assignment) => ({
          ...assignment,
          namespace,
        })),
        issues: result.identity.issues.map(qualify),
      },
    };
  });
  const first = results[0];
  return {
    findings: results.flatMap((result) => result.findings),
    configuration: {
      ...first.configuration,
      issues: results.flatMap((result) => result.configuration.issues),
    },
    identity: {
      assignments: results.flatMap((result) => result.identity.assignments),
      issues: results.flatMap((result) => result.identity.issues),
      groupCount: results.reduce(
        (n, result) => n + result.identity.groupCount,
        0,
      ),
      entityCount: results.reduce(
        (n, result) => n + result.identity.entityCount,
        0,
      ),
    },
  };
}
