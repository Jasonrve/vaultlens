import { CHECK_ID_ALIASES } from '../../shared/auditCheckIds.js';
import { RELATIONSHIP_DETECTORS } from './relationshipDetectors.js';
import { POLICY_DETECTORS } from './policyDetectors.js';
import { AUTH_DETECTORS } from './authDetectors.js';
import { COLLECTED_FIELDS } from './collector.js';
import { parseDocument, parseAllDocuments } from 'yaml';
import { createHash } from 'node:crypto';
import { BUILTIN_YAML } from './builtinCatalog.js';
import { DEFAULT_CONFIG_YAML } from './defaultConfig.js';
import {
  SEVERITIES,
  type RuleDefinition,
  type RuleSettings,
  type RuleView,
  type Severity,
} from '../../shared/auditRules.js';
export const DEFAULT_SETTINGS: RuleSettings = {
  revision: 0,
  configYaml: DEFAULT_CONFIG_YAML,
  customRulesYaml: '',
};
export const SUPPORTED_DETECTORS = [
  'domain_configuration',
  'missing_policy_reference',
  ...AUTH_DETECTORS,
  ...POLICY_DETECTORS,
  ...RELATIONSHIP_DETECTORS,
  'native_root_assignment',
  'native_unbound_approle',
  'field_compare',
];
const legacy = (id: string, detector: string, title: string): string =>
  JSON.stringify({
    version: 1,
    rule: {
      id,
      detector,
      title,
      description: title,
      remediation:
        'Review the assignment and apply explicit least-privilege restrictions.',
      status: 'stable',
      enabled: true,
      severity: 'high',
      finding_kind: 'risky_configuration',
      object_types: ['role', 'entity', 'group'],
    },
  });
const builtins = {
  ...BUILTIN_YAML,
  'LOCAL-ROOT-001': legacy(
    'LOCAL-ROOT-001',
    'native_root_assignment',
    'Root policy assignment',
  ),
  'LOCAL-APPROLE-001': legacy(
    'LOCAL-APPROLE-001',
    'native_unbound_approle',
    'AppRole without SecretID or CIDR restrictions',
  ),
};
const knownDetectors = new Set([
  ...Object.values(BUILTIN_YAML).map(
    (y) => JSON.parse(JSON.stringify(parseDocument(y).toJS())).rule.detector,
  ),
  ...SUPPORTED_DETECTORS,
]);
export function mapping(
  value: unknown,
  field: string,
): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error(`${field} must be a mapping`);
  for (const key of Object.keys(value))
    if (['__proto__', 'constructor', 'prototype'].includes(key))
      throw new Error(`${field}: forbidden key`);
  return value as Record<string, unknown>;
}
function text(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim())
    throw new Error(`${field} must be non-empty text`);
  return value;
}
function strings(value: unknown, field: string): string[] {
  if (
    !Array.isArray(value) ||
    !value.every((v) => typeof v === 'string' && v.trim())
  )
    throw new Error(`${field} must be a string list`);
  return value;
}
function only(
  value: Record<string, unknown>,
  allowed: string[],
  field: string,
) {
  for (const key of Object.keys(value))
    if (!allowed.includes(key)) throw new Error(`${field}: unknown key ${key}`);
}
function decode(yaml: string): unknown {
  if (yaml.length > 256_000) throw new Error('YAML exceeds 256 KB');
  const doc = parseDocument(yaml, { uniqueKeys: true });
  if (doc.errors.length) throw new Error(doc.errors[0].message);
  return doc.toJS({ maxAliasCount: 0 });
}
export function parseRule(yaml: string): RuleDefinition {
  const doc = mapping(decode(yaml), 'document');
  only(doc, ['version', 'rule'], 'document');
  if (doc.version !== 1) throw new Error('Expected version: 1');
  const raw = mapping(doc.rule, 'rule');
  only(
    raw,
    [
      'id',
      'status',
      'enabled',
      'severity',
      'finding_kind',
      'title',
      'description',
      'remediation',
      'object_types',
      'detector',
      'parameters',
      'documentation',
    ],
    'rule',
  );
  const id = text(raw.id, 'rule.id');
  if (!/^[A-Z][A-Z0-9_-]{1,63}$/.test(id)) throw new Error('Invalid rule ID');
  if (!['stable', 'review', 'experimental'].includes(String(raw.status)))
    throw new Error('Invalid rule status');
  if (!SEVERITIES.includes(raw.severity as Severity))
    throw new Error('Invalid rule severity');
  if (
    ![
      'security_issue',
      'risky_configuration',
      'review_recommendation',
    ].includes(String(raw.finding_kind))
  )
    throw new Error('Invalid finding kind');
  if (raw.enabled !== undefined && typeof raw.enabled !== 'boolean')
    throw new Error('enabled must be boolean');
  const detector = text(raw.detector, 'detector');
  if (!knownDetectors.has(detector))
    throw new Error(`Unregistered detector: ${detector}`);
  const object_types = strings(raw.object_types, 'object_types');
  if (!object_types.length) throw new Error('object_types must not be empty');
  const supportedObjectTypes = [
    'pki-role',
    'pki-issuer',
    'transit-key',
    'alias',
    'acl_policy',
    'approle',
    'jwt_role',
    'kubernetes_role',
    'token_role',
    'role',
    'auth_role',
    'entity',
    'group',
    'auth-mount',
  ];
  if (object_types.some((type) => !supportedObjectTypes.includes(type)))
    throw new Error(
      `Unknown object type. Supported values: ${supportedObjectTypes.join(', ')}`,
    );
  const parameters = mapping(raw.parameters ?? {}, 'parameters');
  if (
    ['__proto__', 'prototype', 'constructor'].includes(String(parameters.field))
  )
    throw new Error('Forbidden field name');
  if (detector === 'domain_configuration') {
    const check = String(parameters.check ?? id);
    const supported = ['TOKEN-001','TOKEN-002','TOKEN-003','TOKEN-004','IDENTITY-001','IDENTITY-002','IDENTITY-003','PKI-001','PKI-002','PKI-003','PKI-004','PKI-005','PKI-008','TRANSIT-001','TRANSIT-002','TRANSIT-003'];
    if (!supported.includes(check)) throw new Error('Unknown domain configuration check');
    const threshold = ['TOKEN-004','PKI-003'].includes(check) ? 'max_seconds' : ['PKI-005','TRANSIT-003'].includes(check) ? 'days' : null;
    if (threshold && (typeof parameters[threshold] !== 'number' || !Number.isFinite(parameters[threshold]) || Number(parameters[threshold]) <= 0))
      throw new Error(`${check} requires a positive ${threshold} threshold`);
  }
  if (detector === 'field_compare') {
    if (
      ![...COLLECTED_FIELDS, 'hcl', 'auth_type'].includes(
        String(parameters.field),
      )
    )
      throw new Error('Field is not included in collected snapshots');
    only(
      parameters,
      ['field', 'operator', 'value'],
      'field_compare.parameters',
    );
    if (!/^[a-z][a-z0-9_]{0,63}$/.test(text(parameters.field, 'field')))
      throw new Error('Only a direct configuration field is supported');
    if (
      !['equals', 'contains', 'missing', 'greater_than'].includes(
        String(parameters.operator),
      )
    )
      throw new Error('Invalid comparison operator');
    if (
      parameters.operator !== 'missing' &&
      !['string', 'number', 'boolean'].includes(typeof parameters.value)
    )
      throw new Error('Comparison value must be a scalar');
    if (
      parameters.operator === 'greater_than' &&
      typeof parameters.value !== 'number'
    )
      throw new Error('greater_than requires a numeric value');
  }
  return {
    ...raw,
    id,
    detector,
    object_types,
    parameters,
    enabled: raw.enabled ?? true,
    title: text(raw.title, 'title'),
    description: text(raw.description, 'description'),
    remediation: text(raw.remediation, 'remediation'),
    documentation: strings(raw.documentation ?? [], 'documentation'),
  } as RuleDefinition;
}
export function normalizeConfigIds(yaml: string): string {
  const doc = parseDocument(yaml, { uniqueKeys: true });
  if (doc.errors.length) throw new Error(doc.errors[0].message);
  const raw = doc.toJS({ maxAliasCount: 0 });
  let changed = false;
  for (const [oldId, newId] of Object.entries(CHECK_ID_ALIASES)) {
    if (!doc.hasIn(['rules', oldId])) continue;
    const oldValue = mapping(raw.rules[oldId], oldId);
    const newValue = doc.hasIn(['rules', newId])
      ? mapping(raw.rules[newId], newId) : {};
    doc.setIn(['rules', newId], { ...oldValue, ...newValue });
    doc.deleteIn(['rules', oldId]);
    changed = true;
  }
  return changed ? doc.toString() : yaml;
}
export function parseConfig(yaml: string, ids: Set<string>) {
  yaml = normalizeConfigIds(yaml);
  const raw = mapping(decode(yaml), 'configuration');
  only(
    raw,
    [
      'version',
      'profile',
      'thresholds',
      'approle',
      'jwt',
      'kubernetes',
      'privileged_policies',
      'rules',
    ],
    'configuration',
  );
  if (
    raw.version !== 1 ||
    !['default', 'extended'].includes(String(raw.profile ?? 'default'))
  )
    throw new Error('Expected version: 1 and profile default or extended');
  // Preserve the Python configuration vocabulary for subsequent detector ports.
  const defaults = mapping(decode(DEFAULT_CONFIG_YAML), 'defaults');
  for (const section of [
    'thresholds',
    'approle',
    'jwt',
    'kubernetes',
    'privileged_policies',
  ]) {
    const values = mapping(raw[section] ?? {}, section);
    const schema = mapping(defaults[section], section);
    only(values, Object.keys(schema), section);
    for (const [key, value] of Object.entries(values)) {
      const expected = schema[key];
      if (Array.isArray(expected)) strings(value, `${section}.${key}`);
      else if (expected && typeof expected === 'object') {
        const nested = mapping(value, key);
        for (const v of Object.values(nested)) strings(v, key);
      } else if (typeof expected === 'boolean' && typeof value !== 'boolean')
        throw new Error(`${key} must be boolean`);
      else if (
        typeof expected === 'number' &&
        (typeof value !== 'number' || !Number.isInteger(value) || value < 0)
      )
        throw new Error(`${key} must be a non-negative integer`);
      else if (
        typeof expected === 'string' &&
        !(
          (typeof value === 'number' &&
            Number.isInteger(value) &&
            value >= 0) ||
          (typeof value === 'string' && /^(?:\d+|(?:\d+[smhd])+)$/i.test(value))
        )
      )
        throw new Error(`${key} must be a duration`);
    }
  }
  const overrides = mapping(raw.rules ?? {}, 'rules');
  for (const [id, v] of Object.entries(overrides)) {
    if (!ids.has(id)) throw new Error(`Unknown rule override: ${id}`);
    const override = mapping(v, id);
    only(override, ['enabled', 'severity'], id);
    if (override.enabled !== undefined && typeof override.enabled !== 'boolean')
      throw new Error(`${id}.enabled must be boolean`);
    if (
      override.severity !== undefined &&
      !SEVERITIES.includes(override.severity as Severity)
    )
      throw new Error(`${id}.severity is invalid`);
  }
  return {
    profile: String(raw.profile ?? 'default'),
    overrides: overrides as Record<
      string,
      { enabled?: boolean; severity?: Severity }
    >,
    raw,
  };
}
export function catalog(settings: RuleSettings): RuleView[] {
  const entries: {
    rule: RuleDefinition;
    yaml: string;
    source: 'builtin' | 'custom';
  }[] = Object.values(builtins).map((yaml) => ({
    rule: parseRule(yaml),
    yaml,
    source: 'builtin',
  }));
  if (settings.customRulesYaml.length > 256_000)
    throw new Error('Custom rules exceed 256 KB');
  const docs = parseAllDocuments(settings.customRulesYaml, {
    uniqueKeys: true,
  });
  if (docs.length > 100)
    throw new Error('At most 100 custom rules are supported');
  for (const doc of docs) {
    if (doc.errors.length) throw new Error(doc.errors[0].message);
    if (doc.contents) {
      doc.toJS({ maxAliasCount: 0 });
      const yaml = doc.toString();
      entries.push({ rule: parseRule(yaml), yaml, source: 'custom' });
    }
  }
  const ids = new Set<string>();
  for (const { rule } of entries) {
    if (ids.has(rule.id)) throw new Error(`Duplicate rule ID: ${rule.id}`);
    ids.add(rule.id);
  }
  const config = parseConfig(settings.configYaml, ids);
  return entries
    .map(({ rule, yaml, source }) => {
      const override = config.overrides[rule.id];
      return {
        ...rule,
        source,
        yaml,
        supported: SUPPORTED_DETECTORS.includes(rule.detector),
        active:
          override?.enabled ??
          (rule.enabled &&
            (config.profile === 'extended' || rule.status === 'stable')),
        effectiveSeverity: override?.severity ?? rule.severity,
      };
    })
    .sort((a, b) => a.id.localeCompare(b.id));
}
export function settingsFingerprint(
  settings: RuleSettings,
  definitions?: RuleView[],
): string {
  return createHash('sha256')
    .update(JSON.stringify(definitions ?? builtins))
    .update(settings.configYaml)
    .update('\0')
    .update(settings.customRulesYaml)
    .digest('hex');
}
