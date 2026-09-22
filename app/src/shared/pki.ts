export type CertificateType = "server" | "client" | "both" | "ca" | "unknown";
export type Revocation = "revoked" | "not_revoked" | "unknown";
export interface PkiSource {
  id: string;
  cluster: string;
  namespace: string;
  accessor: string;
  path: string;
  description: string;
  lastCollected: string | null;
  coverage: string;
  certificateCount?: number;
}
export interface CertificateRecord {
  id: number;
  sourceId: string;
  serial: string;
  fingerprint: string;
  cn: string;
  subject: string;
  issuer: string;
  notBefore: number;
  notAfter: number;
  algorithm: string;
  keySize: number;
  curve: string;
  type: CertificateType;
  revoked: Revocation;
  revocationObservedAt: string | null;
  firstSeen: string;
  lastSeen: string;
  presence: string;
  sans: { type: string; value: string }[];
  eku: string[];
  sourcePath?: string;
  role: null;
}
export interface PkiCondition {
  field: string;
  operator: string;
  value: string;
}
export interface PkiQuery {
  sources: string[];
  conditions: PkiCondition[];
  match: "all" | "any";
  type?: string;
  validity?: string;
  revocation?: string;
  sort: "cn" | "serial" | "sourcePath" | "type" | "notAfter" | "revoked";
  direction: "asc" | "desc";
  limit: number;
  offset?: number;
  cursor?: string;
}
export interface PkiJob {
  id: string;
  attempt?: number;
  concurrency?: number | null;
  requestsPerSecond?: number | null;
  sources: string[];
  status: string;
  createdAt: string;
  updatedAt: string;
  total: number;
  completed: number;
  failed: number;
  error: string | null;
}
export interface PkiJobSource {
  sourceId: string;
  path: string;
  namespace: string;
  listed: number;
  status: string;
  startedAt: string | null;
  finishedAt: string | null;
  revocationMode: string;
  revocationError: string | null;
  error: string | null;
  errorCategory: string | null;
  total: number;
  completed: number;
  failed: number;
  pending: number;
}
export interface PkiJobDetails {
  job: PkiJob;
  sources: PkiJobSource[];
  errors: {
    sourceId: string;
    serial: string;
    errorCategory: string | null;
    error: string;
  }[];
  errorsTruncated: boolean;
}
export const pkiSearchFields: Record<
  string,
  { label: string; operators: string[] }
> = {
  text: { label: "Common name, serial or SAN", operators: ["contains"] },
  cn: { label: "Common name", operators: ["contains", "equals", "prefix"] },
  subject: { label: "Subject DN", operators: ["contains", "equals", "prefix"] },
  serial: { label: "Serial number", operators: ["equals", "prefix"] },
  fingerprint: {
    label: "SHA-256 fingerprint",
    operators: ["equals", "prefix"],
  },
  san_dns: { label: "SAN · DNS", operators: ["contains", "equals", "prefix"] },
  san_ip: { label: "SAN · IP", operators: ["equals", "prefix"] },
  san_uri: { label: "SAN · URI", operators: ["contains", "equals", "prefix"] },
  san_email: {
    label: "SAN · Email",
    operators: ["contains", "equals", "prefix"],
  },
  issuer: { label: "Issuer DN", operators: ["contains", "equals", "prefix"] },
  algorithm: { label: "Key algorithm", operators: ["equals"] },
  keySize: { label: "Key size", operators: ["equals", "lt", "gt"] },
  curve: { label: "EC curve", operators: ["equals"] },
  notBefore: { label: "Valid from", operators: ["lt", "gt"] },
  notAfter: { label: "Expires at", operators: ["lt", "gt"] },
};

export interface PkiSummary {
  valid: number;
  warning: number;
  critical: number;
  expired: number;
  revoked: number;
  near: number;
  later: number;
  revocationUnknown: number;
}

export interface PkiSourceCheck {
  sourceId: string;
  checkedAt: string;
  localCount: number;
  vaultCount: number;
  notCollected: number;
  localOnly: number;
}
