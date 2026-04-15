import axios from 'axios';
import type {
  SecretEngine,
  Policy,
  PolicyPath,
  AuthMethod,
  Entity,
  Group,
  GraphData,
  VaultTokenInfo,
} from '../types';

const api = axios.create({
  baseURL: '/api',
  withCredentials: true,
});

// Read CSRF token from cookie and attach to state-changing requests
api.interceptors.request.use((reqConfig) => {
  const method = (reqConfig.method || '').toUpperCase();
  if (['POST', 'PUT', 'DELETE', 'PATCH'].includes(method)) {
    const match = document.cookie.match(/(?:^|;\s*)csrf_token=([^;]*)/);
    if (match?.[1]) {
      reqConfig.headers['X-CSRF-Token'] = decodeURIComponent(match[1]);
    }
  }
  return reqConfig;
});

api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      // Don't redirect when already on /login (avoids reload loop during checkAuth)
      // or on public pages (shared secret viewer)
      const path = window.location.pathname;
      const isPublicPage = path === '/login' || path.startsWith('/shared/') || path.startsWith('/oidc-callback/');
      if (!isPublicPage) {
        window.location.href = '/login';
      }
    }
    return Promise.reject(error);
  },
);

// ── Auth ──────────────────────────────────────────────────
export async function login(token: string) {
  const { data } = await api.post<{ success: boolean; tokenInfo: Partial<VaultTokenInfo> }>(
    '/auth/login',
    { token },
  );
  return data;
}

export async function logout() {
  const { data } = await api.post<{ success: boolean }>('/auth/logout');
  return data;
}

export async function getMe() {
  const { data } = await api.get<{ tokenInfo: Partial<VaultTokenInfo> }>('/auth/me');
  return data;
}

export async function getOidcAuthUrl(mountPath: string, role: string, redirectUri: string) {
  const { data } = await api.post<{ authUrl: string }>('/auth/oidc/auth-url', {
    mountPath,
    role,
    redirectUri,
  });
  return data;
}

export async function oidcCallback(mountPath: string, code: string, state: string) {
  const { data } = await api.post<{
    success: boolean;
    tokenInfo: Partial<VaultTokenInfo>;
  }>('/auth/oidc/callback', { mountPath, code, state });
  return data;
}

// ── Secrets ───────────────────────────────────────────────
export async function getEngines() {
  const { data } = await api.get<{ engines: SecretEngine[] }>('/secrets/engines');
  return data.engines;
}

export async function listSecrets(path: string) {
  const { data } = await api.get<{ keys: string[]; mount: string; version: number }>(
    `/secrets/list/${path}`,
  );
  return data;
}

export async function readSecret(path: string) {
  const { data } = await api.get<{ keys: string[]; mount: string; version: number }>(
    `/secrets/read/${path}`,
  );
  return data;
}

export async function readSecretValues(path: string) {
  const { data } = await api.get<{ data: Record<string, unknown>; mount: string; version: number }>(
    `/secrets/values/${path}`,
  );
  return data;
}

export async function writeSecret(path: string, secretData: Record<string, unknown>) {
  const { data } = await api.post<{ success: boolean; data: unknown }>(
    `/secrets/write/${path}`,
    secretData,
  );
  return data;
}

export async function deleteSecret(path: string) {
  const { data } = await api.delete<{ success: boolean }>(`/secrets/delete/${path}`);
  return data;
}

export async function mergeSecret(path: string, secretData: Record<string, unknown>) {
  const { data } = await api.post<{ success: boolean; updatedKeys: string[] }>(
    `/secrets/merge/${path}`,
    secretData,
  );
  return data;
}

export async function getSecretMetadata(path: string) {
  const { data } = await api.get<{ data: unknown }>(`/secrets/metadata/${path}`);
  return data;
}

export async function updateSecretMetadata(path: string, custom_metadata: Record<string, string>) {
  const { data } = await api.post<{ success: boolean }>(`/secrets/metadata/${path}`, {
    custom_metadata,
  });
  return data;
}

// ── Policies ──────────────────────────────────────────────
export async function getPolicies() {
  const { data } = await api.get<{ policies: string[] }>('/policies');
  return data.policies;
}

export async function getPolicy(name: string) {
  const { data } = await api.get<Policy>(`/policies/${name}`);
  return data;
}

export async function getPolicyPaths(name: string) {
  const { data } = await api.get<{ name: string; paths: PolicyPath[] }>(
    `/policies/${name}/paths`,
  );
  return data;
}

// ── Auth Methods ──────────────────────────────────────────
export async function getAuthMethods() {
  const { data } = await api.get<{ authMethods: AuthMethod[] }>('/auth-methods');
  return data.authMethods;
}

export async function getRoles(method: string) {
  const { data } = await api.get<{ method: string; type: string; roles: string[] }>(
    `/auth-methods/${method}/roles`,
  );
  return data;
}

export async function getRole(method: string, role: string) {
  const { data } = await api.get<{ method: string; role: string; data: Record<string, unknown> }>(
    `/auth-methods/${method}/roles/${role}`,
  );
  return data;
}

export async function createOrUpdateRole(method: string, role: string, roleData: Record<string, unknown>) {
  const { data } = await api.post<{ success: boolean; method: string; role: string }>(
    `/auth-methods/${encodeURIComponent(method)}/roles/${encodeURIComponent(role)}`,
    roleData,
  );
  return data;
}

export async function deleteRole(method: string, role: string) {
  const { data } = await api.delete<{ success: boolean }>(
    `/auth-methods/${encodeURIComponent(method)}/roles/${encodeURIComponent(role)}`,
  );
  return data;
}

export async function getAuthMethodConfig(method: string) {
  const { data } = await api.get<{ config: Record<string, unknown> }>(
    `/auth-methods/${encodeURIComponent(method)}/config`,
  );
  return data.config;
}

export async function updateAuthMethodConfig(method: string, config: Record<string, unknown>) {
  const { data } = await api.post<{ success: boolean }>(
    `/auth-methods/${encodeURIComponent(method)}/config`,
    config,
  );
  return data;
}

export async function getAuthMethodTune(method: string) {
  const { data } = await api.get<{ tune: Record<string, unknown> }>(
    `/auth-methods/${encodeURIComponent(method)}/tune`,
  );
  return data.tune;
}

export async function updateAuthMethodTune(method: string, tune: Record<string, unknown>) {
  const { data } = await api.post<{ success: boolean }>(
    `/auth-methods/${encodeURIComponent(method)}/tune`,
    tune,
  );
  return data;
}

// ── Identity ──────────────────────────────────────────────
export interface EntitySuggestion {
  aliasName: string;
  entityId: string;
  entityName: string;
  mountType: string;
}

export async function getEntitySuggestions() {
  const { data } = await api.get<{ suggestions: EntitySuggestion[] }>('/identity/entity-suggestions');
  return data.suggestions;
}

export async function getEntities() {
  const { data } = await api.get<{ entityIds: string[] }>('/identity/entities');
  return data.entityIds;
}

export async function getEntity(id: string) {
  const { data } = await api.get<{ entity: Entity }>(`/identity/entities/${id}`);
  return data.entity;
}

export async function getGroups() {
  const { data } = await api.get<{ groupIds: string[] }>('/identity/groups');
  return data.groupIds;
}

export async function getEntitiesSummary() {
  const { data } = await api.get<{ entities: { id: string; name: string }[] }>('/identity/entities-summary');
  return data.entities;
}

export async function getGroupsSummary() {
  const { data } = await api.get<{ groups: { id: string; name: string }[] }>('/identity/groups-summary');
  return data.groups;
}

export async function getGroup(id: string) {
  const { data } = await api.get<{ group: Group }>(`/identity/groups/${id}`);
  return data.group;
}

// ── Graph ─────────────────────────────────────────────────
export async function getAuthPolicyMap(refresh = false) {
  const { data } = await api.get<GraphData>('/graph/auth-policy-map', {
    params: refresh ? { refresh: 'true' } : undefined,
  });
  return data;
}

export async function getPolicySecretMap(refresh = false) {
  const { data } = await api.get<GraphData>('/graph/policy-secret-map', {
    params: refresh ? { refresh: 'true' } : undefined,
  });
  return data;
}

export async function getIdentityMap(refresh = false) {
  const { data } = await api.get<GraphData>('/graph/identity-map', {
    params: refresh ? { refresh: 'true' } : undefined,
  });
  return data;
}

export async function getUserIdentityMap(options?: { entityName?: string; entityId?: string }) {
  let url = '/graph/user-identity-map';
  if (options?.entityId) {
    url += `?entityId=${encodeURIComponent(options.entityId)}`;
  } else if (options?.entityName) {
    url += `?entityName=${encodeURIComponent(options.entityName)}`;
  }
  const { data } = await api.get<GraphData>(url);
  return data;
}

// ── Sharing ───────────────────────────────────────────────
export async function createSharedSecret(encrypted: string, expiration: number, oneTime: boolean) {
  const { data } = await api.post<{ id: string; expiresAt: string }>(
    '/sharing',
    { encrypted, expiration, oneTime },
  );
  return data;
}

export async function getSharedSecret(id: string) {
  const { data } = await api.get<{
    encrypted: string;
    createdAt: string;
    expiresAt: string;
    oneTime: boolean;
  }>(`/sharing/${id}`);
  return data;
}

export async function deleteSharedSecret(id: string) {
  const { data } = await api.delete<{ success: boolean }>(`/sharing/${id}`);
  return data;
}

// ── Permissions ───────────────────────────────────────────
export interface PermissionTestResult {
  allowed: boolean;
  capabilities: string[];
  path: string;
  operation: string;
  nodes: import('../types').GraphNode[];
  edges: import('../types').GraphEdge[];
}

export async function testPermissions(paths: string[]) {
  const { data } = await api.post<{ results: Record<string, string[]> }>(
    '/permissions/test',
    { paths },
  );
  return data.results;
}

export async function testEntityPermissions(
  path: string,
  operation: string,
  entityId?: string,
) {
  const { data } = await api.post<PermissionTestResult>(
    '/permissions/test-entity',
    { entityId, path, operation },
  );
  return data;
}

// ── Audit ─────────────────────────────────────────────────
export interface AuditLogEntry {
  requestId: string;
  time: string;
  operation: string;
  path: string;
  mountType: string;
  mountPoint: string;
  displayName: string;
  entityId: string;
  policies: string[];
  clientTokenAccessor: string;
  remoteAddress: string;
  error: string;
  requestData: Record<string, unknown> | null;
  responseData: Record<string, unknown> | null;
  hasResponse: boolean;
}

export async function getAuditLogs(params?: {
  offset?: number;
  limit?: number;
  search?: string;
  operation?: string;
  mountType?: string;
}) {
  const query = new URLSearchParams();
  if (params?.offset) query.set('offset', String(params.offset));
  if (params?.limit) query.set('limit', String(params.limit));
  if (params?.search) query.set('search', params.search);
  if (params?.operation) query.set('operation', params.operation);
  if (params?.mountType) query.set('mountType', params.mountType);
  const qs = query.toString();
  const { data } = await api.get<{ entries: AuditLogEntry[]; total: number; offset: number; limit: number }>(
    `/audit/logs${qs ? `?${qs}` : ''}`,
  );
  return data;
}

// ── Secrets Engines Management ────────────────────────────
export async function enableSecretsEngine(
  path: string,
  type: string,
  description: string,
  options?: Record<string, string>,
) {
  const { data } = await api.post<{ success: boolean }>('/secrets/engines/enable', {
    path,
    type,
    description,
    options,
  });
  return data;
}

export async function disableSecretsEngine(path: string) {
  // path is the mount name without trailing slash
  const cleanPath = path.replace(/\/$/, '');
  const { data } = await api.delete<{ success: boolean }>(`/secrets/engines/${encodeURIComponent(cleanPath)}`);
  return data;
}

export async function getAccessiblePaths() {
  const { data } = await api.get<{ paths: string[] }>('/secrets/accessible-paths');
  return data.paths;
}

// ── Rotation ──────────────────────────────────────────────
export interface RotationEntry {
  path: string;
  mount: string;
  rotateInterval: string;
  rotateIntervalMs: number;
  rotateFormat: string;           // default charset
  rotateKeys: string[];           // keys configured to rotate (empty = all)
  keyFormats: Record<string, string>; // per-key charset overrides
  lastRotated: string | null;
  nextRotation: string;
  secretKeys: string[];           // all keys present in the secret
}

export async function getRotationEntries() {
  const { data } = await api.get<{
    entries: RotationEntry[];
    grouped: Record<string, RotationEntry[]>;
    total: number;
  }>('/rotation');
  return data;
}

export async function rotateSecret(path: string, keys?: string[], length?: number) {
  const { data } = await api.post<{
    success: boolean;
    path: string;
    rotatedKeys: string[];
    rotatedAt: string;
  }>('/rotation/rotate', { path, keys, length });
  return data;
}

export async function getRotationStatus() {
  const { data } = await api.get<{
    schedulerRunning: boolean;
    lastCheck: string | null;
    nextCheck: string | null;
  }>('/rotation/status');
  return data;
}

export async function configureRotation(params: {
  path: string;
  rotateInterval: string;
  rotateKeys?: string;
  rotateFormat?: string;
}) {
  const { data } = await api.post<{ success: boolean; path: string }>('/rotation/configure', params);
  return data;
}

export async function removeRotationRegistration(path: string) {
  const { data } = await api.delete<{ success: boolean; path: string }>(
    `/rotation/registration?path=${encodeURIComponent(path)}`
  );
  return data;
}

// ── Backup ────────────────────────────────────────────────
export interface BackupEntry {
  filename: string;
  size: number;
  createdAt: string;
  type: 'snapshot' | 'legacy-json' | 'kv-json';
}

export async function createKvBackup() {
  const { data } = await api.post<{
    success: boolean;
    filename: string;
    size: number;
    createdAt: string;
    secretCount: number;
  }>('/backup/kv-create', {});
  return data;
}

export async function restoreKvBackup(filename: string) {
  const { data } = await api.post<{
    success: boolean;
    filename: string;
    restoredCount: number;
    failedCount: number;
  }>('/backup/kv-restore', { filename });
  return data;
}

export async function getBackupStatus() {
  const { data } = await api.get<{ raftAvailable: boolean }>('/backup/status');
  return data;
}

export async function createBackup() {
  const { data } = await api.post<{
    success: boolean;
    filename: string;
    size: number;
    createdAt: string;
  }>('/backup/create', {});
  return data;
}

export async function listBackups() {
  const { data } = await api.get<{ backups: BackupEntry[] }>('/backup/list');
  return data.backups;
}

export async function restoreBackup(filename: string) {
  const { data } = await api.post<{
    success: boolean;
    filename: string;
  }>('/backup/restore', { filename });
  return data;
}

export async function deleteBackup(filename: string) {
  const { data } = await api.delete<{ success: boolean }>(`/backup/${encodeURIComponent(filename)}`);
  return data;
}

export async function getBackupSchedule() {
  const { data } = await api.get<{
    enabled: boolean;
    cron: string;
    lastBackup: string | null;
    nextBackup: string | null;
  }>('/backup/schedule');
  return data;
}

export async function updateBackupSchedule(enabled: boolean, cron: string) {
  const { data } = await api.put<{
    enabled: boolean;
    cron: string;
    lastBackup: string | null;
    nextBackup: string | null;
  }>('/backup/schedule', { enabled, cron });
  return data;
}

// ── Hooks (Webhooks) ──────────────────────────────────────
export interface WebhookConfig {
  id: string;
  name: string;
  secretPath: string;
  endpoint: string;
  enabled: boolean;
  createdAt: string;
  lastTriggered: string | null;
  triggerCount: number;
  matchFields: string[];
  matchValues: Record<string, string>;
}

export async function getHooks() {
  const { data } = await api.get<{ hooks: WebhookConfig[] }>('/hooks');
  return data.hooks;
}

export async function createHook(
  name: string,
  secretPath: string,
  endpoint: string,
  matchFields?: string[],
  matchValues?: Record<string, string>,
) {
  const { data } = await api.post<WebhookConfig>('/hooks', { name, secretPath, endpoint, matchFields, matchValues });
  return data;
}

export async function updateHook(id: string, updates: Partial<{ name: string; secretPath: string; endpoint: string; enabled: boolean; matchFields: string[]; matchValues: Record<string, string> }>) {
  const { data } = await api.put<WebhookConfig>(`/hooks/${id}`, updates);
  return data;
}

export async function deleteHook(id: string) {
  const { data } = await api.delete<{ success: boolean }>(`/hooks/${id}`);
  return data;
}

export async function testHook(id: string) {
  const { data } = await api.post<{ success: boolean; statusCode: number; error?: string }>(`/hooks/${id}/test`, {});
  return data;
}

// ── Sys Info ──────────────────────────────────────────────
export async function getVaultHealth() {
  const { data } = await api.get<Record<string, unknown>>('/sys/health');
  return data;
}

export async function getVaultSealStatus() {
  const { data } = await api.get<Record<string, unknown>>('/sys/seal-status');
  return data;
}

export async function getVaultLeader() {
  const { data } = await api.get<Record<string, unknown>>('/sys/leader');
  return data;
}

export async function getVaultMetrics() {
  const { data } = await api.get<Record<string, unknown>>('/sys/metrics');
  return data;
}

// ── System Token Setup ────────────────────────────────────
export interface SysTokenStatus {
  hasSystemToken: boolean;
  source: 'kubernetes' | 'static' | 'approle' | 'none';
  approleConfigured: boolean;
  servicesEnabled: boolean;
}

export async function getSysTokenStatus() {
  const { data } = await api.get<SysTokenStatus>('/sys-token-setup/status');
  return data;
}

export async function checkSysTokenPermissions() {
  const { data } = await api.post<{
    canCreate: boolean;
    approleEnabled: boolean;
    missingCapabilities: string[];
    willCreate: { policy: string; approleRole: string; approleMount: string };
  }>('/sys-token-setup/check-permissions', {});
  return data;
}

export async function previewSysTokenSetup() {
  const { data } = await api.get<{
    policy: { name: string; hcl: string };
    approleRole: { name: string; mount: string; tokenTtl: string; tokenMaxTtl: string; policies: string[] };
  }>('/sys-token-setup/preview');
  return data;
}

export async function createAppRole() {
  const { data } = await api.post<{ success: boolean; message: string }>(
    '/sys-token-setup/create-approle', {}
  );
  return data;
}

export async function testAppRole() {
  const { data } = await api.post<{
    success: boolean;
    message: string;
    policies: string[];
    tokenTtl: number;
  }>('/sys-token-setup/test-approle', {});
  return data;
}

export async function deleteAppRole() {
  const { data } = await api.delete<{ success: boolean; message: string }>(
    '/sys-token-setup/approle'
  );
  return data;
}

export async function getVaultHostInfo() {
  const { data } = await api.get<Record<string, unknown>>('/sys/host-info');
  return data;
}

export async function getVaultInternalCounters() {
  const { data } = await api.get<{
    tokens: Record<string, unknown>;
    entities: Record<string, unknown>;
    requests: Record<string, unknown>;
  }>('/sys/internal-counters');
  return data;
}
