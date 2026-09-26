import { X509Certificate } from "node:crypto";
import type { CertificateChain, PemCertificate } from "../../shared/pkiPem.js";

// Assemble only signature-linked certificates. This is not trust or validity validation.
export function assembleChain(pem: string, candidates: string[]): CertificateChain {
  const leaf = new X509Certificate(pem);
  const pool = new Map<string, X509Certificate>();
  for (const text of candidates) {
    for (const block of text.match(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g) ?? []) {
      try { const c = new X509Certificate(block); if (c.ca) pool.set(c.fingerprint256, c); } catch { /* Ignore malformed candidates. */ }
    }
  }
  const certificates: PemCertificate[] = [];
  const seen = new Set<string>();
  let current = leaf;
  for (let depth = 0; depth < 20; depth++) {
    seen.add(current.fingerprint256);
    const root = current.ca && current.checkIssued(current) && current.verify(current.publicKey);
    certificates.push({ pem: current.toString(), subject: current.subject, root });
    if (root) return { certificates, state: "complete" };
    const matches = [...pool.values()].filter(c => current.checkIssued(c) && current.verify(c.publicKey));
    if (!matches.length) return { certificates, state: "incomplete" };
    if (matches.length > 1) return { certificates, state: "ambiguous" };
    current = matches[0];
    if (seen.has(current.fingerprint256)) return { certificates, state: "cycle" };
  }
  return { certificates, state: "too_long" };
}
