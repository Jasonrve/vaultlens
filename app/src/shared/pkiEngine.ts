import type { CertificateRecord, PkiSource } from "./pki.js";
export function pkiEngineUrl(
  mount: string,
  values: Record<string, string | number | undefined> = {},
) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(values))
    if (value !== undefined) params.set(key, String(value));
  return (
    "/pki/engines/" +
    mount
      .replace(/^\/+|\/+$/g, "")
      .split("/")
      .map(encodeURIComponent)
      .join("/") +
    (params.size ? "?" + params : "")
  );
}
export interface PkiEngineResult {
  source: PkiSource;
  errors?: Record<string, string>;
  warnings?: string[];
  action?: string;
  items?: { id: string; info: unknown }[];
  total?: number;
  nextOffset?: number | null;
  notice?: string;
  data?: Record<string, unknown>;
  certificate?: Omit<
    CertificateRecord,
    | "id"
    | "sourceId"
    | "revoked"
    | "revocationObservedAt"
    | "firstSeen"
    | "lastSeen"
    | "presence"
    | "role"
  >;
  pem?: string;
  revocation?: string;
  observedAt?: string;
  issuer?: { pem: string; subject: string; ref?: string } | null;
  issuerState?: string;
}
