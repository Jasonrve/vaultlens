import crypto from 'crypto';
import { config } from '../config/index.js';
import { getConfigStorage } from './config-storage/index.js';
import type { AuthActionConfig, AuthActionContext, AuthActionDefinition, AuthActionIcon, ResolvedAuthAction } from '../../shared/authActions.js';

const SECTION_PREFIX = 'auth-actions-';
const MAX_ACTIONS = 50;
const MAX_TEXT = 1000;
const VALID_LIBRARIES = new Set<AuthActionIcon['library']>(['lucide', 'material', 'font-awesome', 'iconify']);
const VALID_ICONS = /^(?:[a-z0-9]+(?:[-_:][a-z0-9]+)*)$/i;

export const defaultAuthAction: AuthActionDefinition = {
  id: '', label: '', method: 'GET', url: '', query: {}, form: {}, screens: ['mount'],
  outcome: 'same-tab', responseMode: 'generic', icon: { library: 'lucide', name: 'external-link' },
  iconOnly: false,
  enabled: true, order: 0,
};

function sectionName(scope: AuthActionConfig['scope'], key: string): string {
  return `${SECTION_PREFIX}${scope}-${Buffer.from(key).toString('base64url')}`;
}

function parseConfig(scope: AuthActionConfig['scope'], key: string, data: Record<string, string> | null): AuthActionConfig {
  if (!data) return { scope, key, actions: [] };
  try { return { scope, key, actions: validateActions(JSON.parse(data['actions'] || '[]')) }; }
  catch { return { scope, key, actions: [] }; }
}

export function validateActions(value: unknown): AuthActionDefinition[] {
  if (!Array.isArray(value) || value.length > MAX_ACTIONS) throw new Error(`actions must contain at most ${MAX_ACTIONS} items`);
  return value.map((item, index) => {
    if (!item || typeof item !== 'object') throw new Error(`action ${index + 1} is invalid`);
    const raw = item as Partial<AuthActionDefinition>;
    if (typeof raw.id !== 'string' || !raw.id || raw.id.length > 80) throw new Error(`action ${index + 1} has an invalid id`);
    if (typeof raw.label !== 'string' || !raw.label.trim() || raw.label.length > 100) throw new Error(`action ${index + 1} has an invalid label`);
    if (raw.method !== 'GET' && raw.method !== 'POST') throw new Error(`action ${index + 1} has an invalid method`);
    if (typeof raw.url !== 'string' || !raw.url.length || raw.url.length > MAX_TEXT) throw new Error(`action ${index + 1} has an invalid URL`);
    let parsed: URL;
    try { parsed = new URL(raw.url); } catch { throw new Error(`action ${index + 1} has an invalid URL`); }
    if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error(`action ${index + 1} URL must use HTTP or HTTPS`);
    if (!Array.isArray(raw.screens) || raw.screens.length === 0 || raw.screens.some((screen) => !['list', 'mount', 'role'].includes(screen))) throw new Error(`action ${index + 1} has invalid screens`);
    if (!['popup', 'same-tab', 'new-tab'].includes(raw.outcome ?? '')) throw new Error(`action ${index + 1} has an invalid outcome`);
    if (!['generic', 'body'].includes(raw.responseMode ?? '')) throw new Error(`action ${index + 1} has an invalid response mode`);
    const icon = raw.icon as AuthActionIcon | undefined;
    if (!icon || !VALID_LIBRARIES.has(icon.library) || typeof icon.name !== 'string' || !VALID_ICONS.test(icon.name)) throw new Error(`action ${index + 1} has an invalid icon`);
    const fields = (input: unknown): Record<string, string> => {
      if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error(`action ${index + 1} has invalid fields`);
      const result: Record<string, string> = {};
      for (const [name, fieldValue] of Object.entries(input)) {
        if (!name || name.length > 100 || typeof fieldValue !== 'string' || fieldValue.length > MAX_TEXT) throw new Error(`action ${index + 1} has invalid fields`);
        result[name] = fieldValue;
      }
      return result;
    };
    return { ...defaultAuthAction, ...raw, query: fields(raw.query), form: fields(raw.form), screens: [...new Set(raw.screens)], iconOnly: raw.iconOnly === true, enabled: raw.enabled !== false, order: typeof raw.order === 'number' ? raw.order : index, icon };
  });
}

export async function readAuthActions(scope: AuthActionConfig['scope'], key: string): Promise<AuthActionConfig> {
  if (!key || key.length > 200) return { scope, key, actions: [] };
  return parseConfig(scope, key, await getConfigStorage().get(sectionName(scope, key)));
}

export async function writeAuthActions(value: AuthActionConfig): Promise<void> {
  const actions = validateActions(value.actions);
  await getConfigStorage().set(sectionName(value.scope, value.key), { key: value.key, scope: value.scope, actions: JSON.stringify(actions) });
}

function tokenValue(value: unknown): string { return Array.isArray(value) ? value.map(String).join(', ') : String(value ?? ''); }

export function buildAuthActionTokens(context: AuthActionContext, roleData: Record<string, unknown> = {}): Record<string, string> {
  return {
    VAULT_ADDR: config.vaultAddr, MOUNT_PATH: context.mount?.replace(/\/$/, '') ?? '', ROLE_NAME: context.role ?? '', AUTH_TYPE: context.authType ?? '',
    TOKEN_POLICIES: tokenValue(roleData['token_policies'] ?? roleData['policies']), SA_NAMES: tokenValue(roleData['bound_service_account_names']), SA_NAMESPACES: tokenValue(roleData['bound_service_account_namespaces']),
    SA_NAME_0: tokenValue(Array.isArray(roleData['bound_service_account_names']) ? roleData['bound_service_account_names'][0] : ''), SA_NAMESPACE_0: tokenValue(Array.isArray(roleData['bound_service_account_namespaces']) ? roleData['bound_service_account_namespaces'][0] : ''),
    BOUND_IAM_ROLE_ARNS: tokenValue(roleData['bound_iam_role_arns'] ?? roleData['bound_iam_principal_arns']), BOUND_SUBSCRIPTION_IDS: tokenValue(roleData['bound_subscription_ids']), BOUND_RESOURCE_GROUPS: tokenValue(roleData['bound_resource_groups']),
    BOUND_SERVICE_ACCOUNTS: tokenValue(roleData['bound_service_accounts']), BOUND_PROJECTS: tokenValue(roleData['bound_projects']), BOUND_AUDIENCES: tokenValue(roleData['bound_audiences']), ALLOWED_REDIRECT_URIS: tokenValue(roleData['allowed_redirect_uris']),
  };
}

function replaceTokens(value: string, tokens: Record<string, string>, unresolved: Set<string>): string {
  return value.replace(/\{\{([A-Z0-9_]+)\}\}/g, (match, name: string) => { if (!(name in tokens) || !tokens[name]) { unresolved.add(name); return match; } return tokens[name]; });
}

export function resolveAuthActions(actions: AuthActionDefinition[], context: AuthActionContext, tokens: Record<string, string>): ResolvedAuthAction[] {
  return actions.filter((action) => action.enabled && action.screens.includes(context.screen)).sort((a, b) => a.order - b.order).map((action) => {
    const unresolved = new Set<string>();
    const url = new URL(replaceTokens(action.url, tokens, unresolved));
    for (const [key, value] of Object.entries(action.query)) url.searchParams.set(key, replaceTokens(value, tokens, unresolved));
    const resolvedForm: Record<string, string> = {};
    for (const [key, value] of Object.entries(action.form)) resolvedForm[key] = replaceTokens(value, tokens, unresolved);
    return { ...action, resolvedUrl: url.toString(), resolvedForm, unresolvedTokens: [...unresolved] };
  });
}

export function newAuthAction(): AuthActionDefinition { return { ...defaultAuthAction, id: crypto.randomUUID() }; }