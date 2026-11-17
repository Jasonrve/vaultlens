// Normalized Vault client model shared by the Client Intelligence API and UI.
// Raw Vault data (activity export) is kept apart from derived/enriched fields.
export type Confidence = 'high' | 'medium' | 'low' | 'unknown';
export type ClientCategory = 'Workload' | 'Automation' | 'Human' | 'Service' | 'Unknown';
export type FieldSource = 'vault-activity' | 'identity-api' | 'audit' | 'derived';

export interface IdentityField {
  key: string;
  label: string;
  value: string; // 'Not available' is rendered by the UI when absent
  source: FieldSource;
}

export interface ClientIp {
  ip: string;
  requests: number;
  firstSeen: string;
  lastSeen: string;
}

export interface VaultClientIdentity {
  id: string;
  vaultClientId?: string;
  displayName: string;
  clientType: string; // Vault client type: entity | non-entity-token | secret-sync | acme ...
  category: ClientCategory;
  vaultNamespace?: string;
  auth: { type: string; mountPath?: string; mountAccessor?: string; role?: string };
  identity: { entityId?: string; aliasName?: string; metadata: Record<string, string> };
  source: {
    platform: string;
    primaryIdentifier: string;
    fields: IdentityField[];
    confidence: Confidence;
    evidence: string[];
  };
  network: { observedIps: string[]; lastObservedIp?: string; ips: ClientIp[] };
  activity: {
    firstObservedAt?: string;
    lastObservedAt?: string;
    requests?: number; // selected window; undefined = no audit observation
    requests24h?: number;
    requests7d?: number;
    requests30d?: number;
    observedErrors?: number;
    inVaultActivity: boolean;
  };
  origins: FieldSource[];
}

export interface CoverageInfo {
  auditAvailable: boolean;
  collectionStartedAt?: string;
  lastIngestedAt?: string;
  dataGapAt?: string; // last audit-buffer overflow inside the window: request counts around then are undercounted
  requestedDays: number;
  coveredDays: number; // days of the window actually covered by retained audit data
  partial: boolean;
}

export interface ActivityStatus {
  available: boolean;
  reason?: 'disabled' | 'no_data' | 'forbidden' | 'unsupported' | 'error';
  message?: string;
  exportAvailable: boolean;
  startTime?: string;
  endTime?: string;
}

export interface ClientSummary {
  uniqueClients: number | null; // Vault client count, deduplicated per billing period
  activeClients: number | null; // observed in audit within window
  unattributed: number | null;
  uniqueIps: number | null;
  windowDays: number;
  coverage: CoverageInfo;
  activity: ActivityStatus;
  retentionDays: number;
}

export interface ClientQuery {
  days: number;
  search?: string;
  backend?: string;
  clientType?: string;
  mount?: string;
  confidence?: Confidence;
  unidentified?: boolean;
  ip?: string; // exact IP or CIDR
  sort?: 'client' | 'backend' | 'role' | 'type' | 'requests' | 'lastSeen' | 'confidence';
  dir?: 'asc' | 'desc';
  offset?: number;
  limit?: number;
}

export interface ClientListResponse {
  clients: VaultClientIdentity[];
  total: number;
  offset: number;
  limit: number;
  coverage: CoverageInfo;
}

export interface BackendCount { type: string; count: number }
export interface BackendsResponse { backends: BackendCount[]; mounts: string[] }
export interface ActivityPoint { day: string; total: number; byBackend: Record<string, number> }
export interface ActivityResponse {
  bucket?: 'day' | 'hour'; // points[].day is 'YYYY-MM-DD' (day) or 'YYYY-MM-DDTHH' (hour), UTC
  points: ActivityPoint[];
  coverage: CoverageInfo;
  // Vault's own monthly deduplicated client counts — NOT request counts.
  vaultMonthly: { month: string; clients: number }[];
}
export interface EvidenceEvent { time: string; requestId: string; operation: string; path: string; ip: string; error: boolean }
export interface ClientDetailResponse {
  client: VaultClientIdentity;
  history: { day: string; requests: number }[];
  evidence: EvidenceEvent[];
  coverage: CoverageInfo;
}

export interface TopClient { id: string; displayName: string; backend: string; role?: string; detail?: string; requests: number; share: number; errors: number; lastSeen?: string }
export interface BackendUsage { type: string; clients: number; requests: number; share: number }
export interface TopResponse { totalRequests: number; clients: TopClient[]; backends: BackendUsage[]; coverage: CoverageInfo }
