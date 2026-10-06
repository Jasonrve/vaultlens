import { X509Certificate } from "node:crypto";
import type { CertificateRecord } from "../../shared/pki.js";
export function normalizeSerial(value: string): string {
  const clean = value.replace(/[:-]/g, "").toLowerCase();
  if (!/^[a-f0-9]{1,128}$/.test(clean))
    throw new Error("Invalid serial number");
  return clean.replace(/^0+(?=.)/, "");
}
export function normalizeFingerprint(value: string): string {
  const clean = value.replace(/:/g, "").toLowerCase();
  if (!/^[a-f0-9]{1,64}$/.test(clean)) throw new Error("Invalid fingerprint");
  return clean;
}
// Node quotes SAN values containing separators as JSON strings.
export function parseSans(text = ""): { type: string; value: string }[] {
  const result: { type: string; value: string }[] = [];
  for (const part of text.match(/(?:[^,"\n]|"(?:[^"\\]|\\.)*")+/g) ?? []) {
    const match = part.trim().match(/^(DNS|IP Address|URI|email):(.*)$/);
    if (!match) continue;
    const raw = match[2];
    result.push({
      type: (
        {
          DNS: "dns",
          "IP Address": "ip",
          URI: "uri",
          email: "email",
        } as Record<string, string>
      )[match[1]],
      value: raw.startsWith('"') ? JSON.parse(raw) : raw,
    });
  }
  return result;
}
export function parseCertificate(pem: string) {
  const cert = new X509Certificate(pem);
  const key = cert.publicKey.asymmetricKeyDetails;
  const eku = cert.keyUsage ?? [];
  const server = eku.includes("1.3.6.1.5.5.7.3.1"),
    client = eku.includes("1.3.6.1.5.5.7.3.2");
  const algorithm = cert.publicKey.asymmetricKeyType ?? "unknown";
  return {
    serial: normalizeSerial(cert.serialNumber),
    fingerprint: normalizeFingerprint(cert.fingerprint256),
    cn:
      cert.subject
        .split("\n")
        .find((v) => v.startsWith("CN="))
        ?.slice(3) ?? "",
    subject: cert.subject,
    issuer: cert.issuer,
    notBefore: Date.parse(cert.validFrom),
    notAfter: Date.parse(cert.validTo),
    algorithm:
      algorithm === "rsa" || algorithm === "rsa-pss"
        ? "RSA"
        : algorithm === "ec"
          ? "EC"
          : algorithm,
    keySize: key?.modulusLength ?? 0,
    curve: key?.namedCurve ?? "",
    type: (cert.ca
      ? "ca"
      : server && client
        ? "both"
        : server
          ? "server"
          : client
            ? "client"
            : "unknown") as CertificateRecord["type"],
    sans: parseSans(cert.subjectAltName),
    eku,
    der: cert.raw,
  };
}
