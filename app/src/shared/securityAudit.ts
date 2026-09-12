export interface AuditResource {
  observedAt?: string;
  retainedFromSnapshotAt?: string;
  namespace?: string;
  kind: string;
  path: string;
  data: Record<string, unknown>;
}
export interface AuditIssue {
  namespace?: string;
  path: string;
  reason: string;
}
export interface IdentityAnalysis {
  assignments: {
    namespace?: string;
    subjectPath: string;
    subjectKind: string;
    policy: string;
    relationship: 'assigned' | 'inherited';
    sourcePath: string;
  }[];
  issues: AuditIssue[];
  groupCount: number;
  entityCount: number;
}
export interface AuditSnapshot {
  refresh?: {
    sources: string[];
    retainedResources: number;
    retainedFrom: string;
  };
  checkpoint?: {
    savedAt: string;
    completedNamespaces: string[];
    completedStages?: { namespace: string; stage: string }[];
  };
  importedFrom?: {
    tool: 'vault-security-audit';
    schemaVersion: 2 | 3;
    scanId: string;
    collection?: {
      scope: {
        policyFilters: string[];
        authMountFilters: string[];
        authTypeFilters: string[];
        skipIdentity: boolean;
      };
      maxObjects: number;
      sources: string[];
      recursiveNamespaces: boolean;
      namespaceFilters: string[];
    };
  };
  importedCoverage?: {
    namespace: string;
    source: string;
    status: string;
    discovered: number;
    scanned: number;
    details: string | null;
  }[];
  namespaces?: string[];
  namespaceAliasCompleteness?: Record<string, boolean>;
  namespacePolicyCompleteness?: Record<string, boolean>;
  controls?: AuditControls;
  analysisPerformed?: boolean;
  sourceRunId?: string;
  collection?: {
    stageResults?: {
      namespace: string;
      stage: string;
      complete: boolean;
      finishedAt: string;
    }[];
    workers?: number;
    scope?: {
      policyFilters: string[];
      authMountFilters: string[];
      authTypeFilters: string[];
      skipIdentity: boolean;
    };
    requestPolicy: {
      sources?: string[];
      namespaceFilters?: string[];
      recursiveNamespaces?: boolean;
      redactPolicySource?: boolean;
      maxObjects?: number;
      retries: number;
      requestsPerSecond: number;
      retryBackoffMs: number;
    };
    metrics: {
      requests: number;
      retries: number;
      rateWaitMs: number;
      retryWaitMs: number;
    };
  };
  identity?: IdentityAnalysis;
  version: 1;
  target: string;
  startedAt: string;
  finishedAt: string;
  resources: AuditResource[];
  issues: AuditIssue[];
  policiesComplete: boolean;
}
export interface AuditFinding {
  namespace?: string;
  relatedObjects?: { kind: string; path: string; name: string }[];
  policyPath?: string;
  line?: number;
  matchedBlock?: string;
  attributes?: Record<string, unknown>;
  ruleId: string;
  severity: import('./auditRules.js').Severity;
  path: string;
  title: string;
  evidence: string;
  recommendation: string;
}
export interface AuditProgress {
  namespace: string;
  phase: string;
  resources: number;
  requests: number;
  updatedAt: string;
}
export interface AuditRun {
  snapshotId?: string | null;
  operation?: 'collect' | 'analyze' | 'import';
  progress?: AuditProgress | null;
  failureReason?: string | null;
  id: string;
  target: string;
  startedAt: string;
  finishedAt: string | null;
  status:
    | 'running'
    | 'collected'
    | 'completed'
    | 'partial'
    | 'failed'
    | 'interrupted';
  resourceCount: number;
  issueCount: number;
  findingCount: number;
}
export interface AuditDetail {
  findingControls?: (AuditControls['states'][number] | null)[];
  run: AuditRun;
  snapshot: AuditSnapshot | null;
  findings: AuditFinding[];
  configuration?: import('./auditRules.js').RunConfiguration | null;
}

export interface AuditDiff {
  oldRunId: string;
  newRunId: string;
  target: string;
  warnings: string[];
  statistics: Record<string, Record<string, number>>;
  changes: Record<
    string,
    {
      change: 'added' | 'removed' | 'changed' | 'unchanged';
      old?: unknown;
      new?: unknown;
    }[]
  >;
}

export interface AuditException {
  name?: string;
  enabled?: boolean;
  builtin?: boolean;
  object_type?: 'policy' | 'token' | 'auth-role' | 'entity' | 'group' | 'any';
  match?: 'exact' | 'glob';
  id: string;
  rule_id: string;
  namespace: string;
  object_path: string;
  policy_path?: string;
  owner: string;
  reason: string;
  expires: string;
}
export interface AuditControls {
  appliedOn: string;
  baseline: {
    source_scan_id: string;
    config_hash: string;
    engine_version: string;
    fingerprints: string[];
    target: string;
  } | null;
  exceptionDefinitions: AuditException[];
  states: {
    fingerprint: string;
    baselineStatus: string | null;
    suppressed: boolean;
    gate: boolean;
    exception: AuditException | null;
  }[];
  exceptions: {
    configured: number;
    active: number;
    expired: AuditException[];
    unused: AuditException[];
  };
  absentFingerprints: string[];
}

/** A saved collection is independent of the analysis runs that reference it. */
export interface SavedAuditSnapshot {
  id: string;
  target: string;
  createdAt: string;
  sourceJobId: string | null;
  parentId: string | null;
  origin: 'collection' | 'import';
  resourceCount: number;
  issueCount: number;
  retainedCount: number;
  changes: {
    added: number;
    changed: number;
    unchanged: number;
    absent: number;
  };
}
export interface AuditInventoryView {
  target: string;
  storagePath: string;
  current: SavedAuditSnapshot | null;
  snapshot: AuditSnapshot | null;
  snapshots: SavedAuditSnapshot[];
}
