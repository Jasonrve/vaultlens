import type { CertificateRecord } from "./pki.js";
export type IssuerCertificateInfo = Pick<CertificateRecord, "serial" | "fingerprint" | "subject" | "issuer" | "notBefore" | "notAfter" | "algorithm" | "keySize" | "curve" | "sans"> & { root: boolean };
export interface PemCertificate { pem: string; subject: string; root: boolean }
export interface CertificateChain {
  certificates: PemCertificate[];
  state: "complete" | "incomplete" | "ambiguous" | "cycle" | "too_long";
}
export function certificatePemOptions(pem: string, chain?: CertificateChain) {
  const certificates = chain?.certificates ?? [];
  const leaf = certificates[0];
  const cas = certificates.slice(1);
  const intermediates = cas.filter(c => !c.root);
  const root = certificates.find(c => c.root);
  const complete = chain?.state === "complete";
  const reason = `Chain ${chain?.state ?? "unavailable"}; a complete signing chain is required.`;
  const option = (id: string, label: string, description: string, parts: string[], available = true, unavailable = reason) => ({
    id, label, description, pem: parts.map(p => p.trim()).join("\n") + "\n", count: parts.length,
    disabled: !available || !parts.length, reason: available && parts.length ? "" : unavailable,
  });
  return [
    option("certificate", "Certificate only", "This certificate", [pem]),
    option("fullchain", "Certificate + intermediates", "Certificate → intermediate CAs · No root", leaf?.root ? [] : [pem, ...intermediates.map(c => c.pem)], complete && !leaf?.root),
    option("fullchain-with-root", "Full chain including root", "Certificate → intermediate CAs → root", certificates.map(c => c.pem), complete),
    option("ca-chain", "CA chain only", "Intermediate CAs → root · No leaf", cas.map(c => c.pem), complete && !!cas.length),
    option("intermediate-ca", "Intermediate CA only", cas[0]?.subject ?? "Direct signing CA", cas[0] && !cas[0].root ? [cas[0].pem] : [], !!cas[0] && !cas[0].root, "No verified intermediate signing CA is available."),
    option("root-ca", "Root CA only", root?.subject ?? "Root CA", root ? [root.pem] : [], complete && !!root, "No verified root CA is available."),
  ];
}
