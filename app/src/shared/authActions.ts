export type AuthActionScreen = 'list' | 'mount' | 'role';
export type AuthActionMethod = 'GET' | 'POST';
export type AuthActionOutcome = 'popup' | 'same-tab' | 'new-tab';
export type AuthActionResponseMode = 'generic' | 'body';

export interface AuthActionIcon {
  library: 'lucide' | 'material' | 'font-awesome' | 'iconify';
  name: string;
}

export interface AuthActionDefinition {
  id: string;
  label: string;
  method: AuthActionMethod;
  url: string;
  query: Record<string, string>;
  form: Record<string, string>;
  screens: AuthActionScreen[];
  outcome: AuthActionOutcome;
  responseMode: AuthActionResponseMode;
  icon: AuthActionIcon;
  iconOnly: boolean;
  enabled: boolean;
  order: number;
}

export interface ResolvedAuthAction extends AuthActionDefinition {
  resolvedUrl: string;
  resolvedForm: Record<string, string>;
  unresolvedTokens: string[];
}

export interface AuthActionContext {
  screen: AuthActionScreen;
  mount?: string;
  role?: string;
  authType?: string;
}

export interface AuthActionConfig {
  scope: 'auth-type' | 'mount';
  key: string;
  actions: AuthActionDefinition[];
}

export const AUTH_ACTION_TOKENS = [
  'VAULT_ADDR', 'MOUNT_PATH', 'ROLE_NAME', 'AUTH_TYPE', 'TOKEN_POLICIES',
  'SA_NAMES', 'SA_NAMESPACES', 'SA_NAME_0', 'SA_NAMESPACE_0',
  'BOUND_IAM_ROLE_ARNS', 'BOUND_SUBSCRIPTION_IDS', 'BOUND_RESOURCE_GROUPS',
  'BOUND_SERVICE_ACCOUNTS', 'BOUND_PROJECTS', 'BOUND_AUDIENCES',
  'ALLOWED_REDIRECT_URIS',
] as const;

export type AuthActionToken = typeof AUTH_ACTION_TOKENS[number];