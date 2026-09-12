export const SOURCE_STAGES: Record<string, string[]> = {
  policies: ['Policies'],
  identity: ['Identity entities', 'Identity groups'],
  identity_aliases: ['Identity aliases'],
  mounts: ['Secret mounts', 'Auth mounts and roles'],
  auth_roles: ['Auth mounts and roles'],
};
export const COLLECTION_SOURCES = Object.keys(SOURCE_STAGES).sort();
export const RESOURCE_STAGE: Record<string, string> = {
  'pki-role': 'Secret mounts',
  'pki-issuer': 'Secret mounts',
  'transit-key': 'Secret mounts',
  policy: 'Policies',
  entity: 'Identity entities',
  group: 'Identity groups',
  alias: 'Identity aliases',
  'secret-mount': 'Secret mounts',
  'auth-mount': 'Auth mounts and roles',
  role: 'Auth mounts and roles',
};
export const stageKey = (namespace: string, stage: string) =>
  JSON.stringify([namespace, stage]);
