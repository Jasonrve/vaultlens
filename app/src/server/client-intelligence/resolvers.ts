import type { ClientCategory, Confidence, IdentityField } from '../../shared/clientIntelligence.js';

export interface ResolverInput {
  mountType: string; // '' when unknown
  aliasName?: string;
  metadata: Record<string, string>; // alias metadata + custom metadata, already sanitized
  role?: string;
}

export interface Resolved {
  platform: string;
  category: ClientCategory;
  primaryIdentifier: string;
  /** Short human-friendly name (service account, role, ...); falls back to the alias when absent. */
  title?: string;
  fields: IdentityField[];
  confidence: Confidence;
  evidence: string[];
}

type Resolver = (i: ResolverInput) => Resolved;

const SENSITIVE_KEY = /(secret|password|passwd|client_token|^token$|private|credential|api_?key)/i;
const MAX_VALUE = 512;

/** Drops secret-looking keys and control characters; metadata is untrusted. */
export function sanitizeMetadata(raw: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (SENSITIVE_KEY.test(k) || v === null || typeof v === 'object') continue;
    // eslint-disable-next-line no-control-regex
    out[k.slice(0, 128)] = String(v).replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, MAX_VALUE);
  }
  return out;
}

const first = (m: Record<string, string>, ...keys: string[]) => {
  for (const k of keys) if (m[k]) return m[k];
  return undefined;
};

type Pending = [key: string, label: string, value: string | undefined, source?: IdentityField['source']];
const mkFields = (rows: Pending[]): IdentityField[] =>
  rows
    .filter((r): r is [string, string, string, IdentityField['source']?] => !!r[2])
    .map(([key, label, value, source]) => ({ key, label, value, source: source ?? 'identity-api' }));

const NA = 'Not available';

/** ARN -> account id / principal type / name. Account is only returned for a well-formed 12-digit ARN. */
export function parseAwsArn(arn: string | undefined) {
  const m = /^arn:aws[a-z-]*:(iam|sts)::(\d{12}):(user|role|assumed-role|root|instance-profile)(?:\/(.+))?$/.exec(arn ?? '');
  if (!m) return undefined;
  const parts = (m[4] ?? '').split('/');
  const type = m[3] === 'assumed-role' ? 'role' : m[3];
  const name = m[3] === 'assumed-role' ? parts[0] : parts[parts.length - 1];
  return { account: m[2]!, type: type!, name: name || undefined };
}

const kubernetes: Resolver = ({ aliasName, metadata, role }) => {
  const ns = first(metadata, 'service_account_namespace');
  const sa = first(metadata, 'service_account_name');
  const full = !!(ns && sa);
  return {
    platform: 'Kubernetes',
    category: 'Workload',
    title: sa,
    primaryIdentifier: full ? `namespace: ${ns}\nsa: ${sa}` : sa ? `sa: ${sa}` : aliasName ? `alias: ${aliasName}` : NA,
    fields: mkFields([
      ['namespace', 'Kubernetes namespace', ns],
      ['serviceAccount', 'Service account', sa],
      ['serviceAccountUid', 'Service account UID', first(metadata, 'service_account_uid') ?? aliasName],
      ['role', 'Auth role', role ?? first(metadata, 'role')],
      ['cluster', 'Cluster', first(metadata, 'cluster', 'cluster_name')],
    ]),
    confidence: full ? 'high' : sa || ns ? 'medium' : 'low',
    evidence: full
      ? ['service_account_namespace and service_account_name present in alias metadata']
      : ['alias metadata lacks service account namespace/name'],
  };
};

const github: Resolver = ({ aliasName, metadata, role }) => {
  const repo = first(metadata, 'repository', 'repo');
  const org = first(metadata, 'org', 'organization', 'repository_owner');
  return {
    platform: 'GitHub',
    category: repo ? 'Automation' : 'Human',
    primaryIdentifier: repo ? `repo: ${repo}` : aliasName ? `user: ${aliasName}` : NA,
    fields: mkFields([
      ['username', 'GitHub username', first(metadata, 'username') ?? aliasName],
      ['org', 'Organization', org],
      ['repository', 'Repository', repo],
      ['workflow', 'Workflow', first(metadata, 'workflow', 'job_workflow_ref')],
      ['role', 'Auth role', role],
    ]),
    confidence: repo || aliasName ? 'high' : 'low',
    evidence: [repo ? 'repository claim mapped into Vault metadata' : 'GitHub auth identifies the user; repository not available'],
  };
};

const aws: Resolver = ({ aliasName, metadata, role }) => {
  const arn = first(metadata, 'canonical_arn', 'client_arn') ?? (aliasName?.startsWith('arn:') ? aliasName : undefined);
  const p = parseAwsArn(arn);
  const account = p?.account ?? first(metadata, 'account_id');
  return {
    platform: 'AWS IAM',
    category: 'Workload',
    title: p?.name,
    primaryIdentifier: arn ?? (aliasName ? `alias: ${aliasName}` : NA),
    fields: mkFields([
      ['account', 'AWS account ID', account, p ? 'derived' : 'identity-api'],
      ['arn', 'IAM principal ARN', arn],
      ['principalType', 'Principal type', p?.type ?? first(metadata, 'inferred_entity_type')],
      ['principalName', 'Principal name', p?.name],
      ['authType', 'Auth mode', first(metadata, 'auth_type')],
      ['uniqueId', 'Alias / unique ID', aliasName && aliasName !== arn ? aliasName : undefined],
      ['role', 'Auth role', role ?? first(metadata, 'role_tag')],
    ]),
    confidence: p ? 'high' : arn || aliasName ? 'medium' : 'low',
    evidence: [p ? 'well-formed IAM ARN in alias metadata' : 'no resolvable IAM ARN; account may be unknown'],
  };
};

const approle: Resolver = ({ aliasName, metadata, role }) => {
  const name = role ?? first(metadata, 'role_name');
  return {
    platform: 'AppRole',
    category: 'Automation',
    primaryIdentifier: name ? `role: ${name}${aliasName ? `\nrole_id: ${aliasName}` : ''}` : aliasName ? `role_id: ${aliasName}` : NA,
    fields: mkFields([
      ['role', 'AppRole role name', name],
      ['roleId', 'Role ID', aliasName], // the alias name of an AppRole entity is its RoleID; SecretIDs are never read
    ]),
    confidence: name ? 'high' : aliasName ? 'medium' : 'low',
    evidence: ['workloads sharing one AppRole are indistinguishable to Vault and appear as one client'],
  };
};

const named = (platform: string, category: ClientCategory, label: string, extra: string[] = []): Resolver =>
  ({ aliasName, metadata, role }) => ({
    platform,
    category,
    primaryIdentifier: aliasName ? `${label.toLowerCase()}: ${aliasName}` : NA,
    fields: mkFields([
      ['username', label, aliasName],
      ...extra.map((k): Pending => [k, k.replace(/_/g, ' '), metadata[k]]),
      ['role', 'Auth role', role],
    ]),
    confidence: aliasName ? 'high' : 'low',
    evidence: [aliasName ? `${platform} alias name` : `${platform} client without alias`],
  });

let claimMap: Record<string, string[]> | undefined;
function claims(): Record<string, string[]> {
  if (!claimMap) {
    const defaults: Record<string, string[]> = {
      Subject: ['sub', 'subject'],
      Email: ['email'],
      Issuer: ['iss', 'issuer'],
      'Application / client ID': ['azp', 'aud', 'client_id', 'appid'],
      'Preferred username': ['preferred_username', 'username', 'name'],
      Repository: ['repository', 'repo'],
      Workflow: ['workflow', 'job_workflow_ref'],
      'Repository owner': ['repository_owner', 'org'],
    };
    try {
      const extra = JSON.parse(process.env['VAULTLENS_CLIENT_INTEL_CLAIM_MAP'] || '{}') as Record<string, string[]>;
      for (const [label, keys] of Object.entries(extra)) if (Array.isArray(keys)) defaults[label] = keys.map(String);
    } catch {
      /* invalid mapping: keep defaults */
    }
    claimMap = defaults;
  }
  return claimMap;
}
export function resetClaimMap() {
  claimMap = undefined;
}

const oidcLike = (platform: string): Resolver => ({ aliasName, metadata, role }) => {
  const rows: Pending[] = Object.entries(claims()).map(([label, keys]) => [label, label, first(metadata, ...keys)]);
  const repo = first(metadata, ...(claims()['Repository'] ?? []));
  const email = first(metadata, ...(claims()['Email'] ?? []));
  const subject = aliasName ?? first(metadata, ...(claims()['Subject'] ?? []));
  const primary = repo ? `repo: ${repo}` : email ?? subject;
  return {
    platform,
    category: repo ? 'Automation' : 'Human',
    primaryIdentifier: primary ?? NA,
    fields: mkFields([...rows, ['role', 'Auth role', role]]),
    confidence: primary ? (subject ? 'high' : 'medium') : 'low',
    evidence: [primary ? 'identity claims mapped into alias metadata' : 'no mapped identity claims'],
  };
};

const cert: Resolver = ({ aliasName, metadata, role }) => {
  const cn = first(metadata, 'common_name', 'cert_name') ?? aliasName;
  return {
    platform: 'TLS Certificate',
    category: 'Automation',
    primaryIdentifier: cn ? `CN: ${cn}` : NA,
    fields: mkFields([
      ['commonName', 'Common name', cn],
      ['serial', 'Serial number', first(metadata, 'serial_number')],
      ['subjectKeyId', 'Subject key ID', first(metadata, 'subject_key_id')],
      ['san', 'SAN', first(metadata, 'dns_names', 'uri_sans', 'email_sans')],
      ['role', 'Auth role', role ?? first(metadata, 'cert_name')],
    ]),
    confidence: cn ? 'high' : 'low',
    evidence: [cn ? 'certificate common name / alias' : 'no certificate identity'],
  };
};

const token: Resolver = ({ aliasName, metadata }) => ({
  platform: 'Token',
  category: 'Service',
  primaryIdentifier: metadata['display_name'] ? `display: ${metadata['display_name']}` : aliasName ? `alias: ${aliasName}` : NA,
  fields: mkFields([
    ['displayName', 'Token display name', metadata['display_name']],
    ['origin', 'Authentication origin', metadata['origin']],
  ]),
  // A non-entity token has no stable human identity in Vault's activity data.
  confidence: metadata['display_name'] ? 'medium' : 'low',
  evidence: ['non-entity tokens are counted by token, not by caller; raw tokens are never read'],
});

const generic: Resolver = ({ mountType, aliasName, metadata, role }) => ({
  platform: mountType || 'Unknown',
  category: 'Unknown',
  primaryIdentifier: aliasName ?? NA,
  fields: mkFields([
    ['alias', 'Alias name', aliasName],
    ['role', 'Auth role', role],
    ...Object.entries(metadata).slice(0, 12).map(([k, v]): Pending => [`meta.${k}`, k, v]),
  ]),
  confidence: !mountType ? (aliasName ? 'low' : 'unknown') : aliasName ? 'medium' : 'low',
  evidence: [mountType ? `generic resolver for auth type "${mountType}"` : 'auth mount could not be resolved'],
});

const RESOLVERS: Record<string, Resolver> = {
  kubernetes,
  github,
  aws,
  approle,
  ldap: named('LDAP', 'Human', 'Username', ['dn', 'email']),
  userpass: named('Userpass', 'Human', 'Username'),
  oidc: oidcLike('OIDC'),
  jwt: oidcLike('JWT'),
  cert,
  token,
};

/** Backend-specific identity resolution; unknown/custom mount types use the generic resolver. */
export function resolveIdentity(input: ResolverInput): Resolved {
  return (RESOLVERS[input.mountType] ?? generic)(input);
}

/** Backend key used for icons/grouping; Vault's ns_token mount type is a token. */
export function normalizeBackend(mountType: string | undefined): string {
  if (!mountType) return 'unknown';
  return mountType === 'ns_token' ? 'token' : mountType;
}
