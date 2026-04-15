export interface VaultTokenInfo {
  accessor: string;
  creation_time: number;
  creation_ttl: number;
  display_name: string;
  entity_id: string;
  expire_time: string | null;
  explicit_max_ttl: number;
  id: string;
  meta: Record<string, string> | null;
  num_uses: number;
  orphan: boolean;
  path: string;
  policies: string[];
  ttl: number;
  type: string;
}

export interface SecretEngine {
  type: string;
  description: string;
  accessor: string;
  options: Record<string, string> | null;
  local: boolean;
  seal_wrap: boolean;
  path: string;
}

export interface Secret {
  data: Record<string, unknown>;
  metadata?: {
    created_time: string;
    custom_metadata: Record<string, string> | null;
    deletion_time: string;
    destroyed: boolean;
    version: number;
  };
}

export interface Policy {
  name: string;
  rules: string;
}

export interface PolicyPath {
  path: string;
  capabilities: string[];
}

export interface AuthMethod {
  type: string;
  description: string;
  accessor: string;
  path: string;
  config: Record<string, unknown>;
}

export interface Role {
  name: string;
  [key: string]: unknown;
}

export interface Entity {
  id: string;
  name: string;
  aliases: Array<{
    id: string;
    name: string;
    mount_accessor: string;
    mount_type: string;
  }>;
  policies: string[];
  metadata: Record<string, string> | null;
  group_ids: string[];
  direct_policies: string[];
  inherited_policies: string[];
}

export interface Group {
  id: string;
  name: string;
  policies: string[];
  member_entity_ids: string[];
  member_group_ids: string[];
  parent_group_ids: string[];
  metadata: Record<string, string> | null;
  type: string;
}

export interface GraphNode {
  id: string;
  type: string;
  data: {
    label: string;
    [key: string]: unknown;
  };
  position: { x: number; y: number };
}

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  label?: string;
}

export interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
  cachedAt?: number;   // unix ms timestamp of when data was cached on the server
  fromCache?: boolean; // true if the response was served from the server cache
}

export interface SysTokenStatus {
  hasSystemToken: boolean;
  source: 'kubernetes' | 'static' | 'approle' | 'none';
  approleConfigured: boolean;
  servicesEnabled: boolean;
}
