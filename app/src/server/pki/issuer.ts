import { assembleChain } from "./chain.js";
import { X509Certificate } from "node:crypto";
import { PkiAdapter } from "./adapter.js";
import type { PkiSource } from "../../shared/pki.js";
export async function findIssuer(
  pem: string,
  source: PkiSource,
  adapter: PkiAdapter,
) {
  const leaf = new X509Certificate(pem);
  const matches = (candidate: X509Certificate) =>
    candidate.ca &&
    leaf.checkIssued(candidate) &&
    leaf.verify(candidate.publicKey);
  if (matches(leaf))
    return { issuer: { pem, subject: leaf.subject }, issuerState: "verified", chain: assembleChain(pem, []) };
  let candidates: string[] = [];
  try {
    const keys = (await adapter.request(source.path + "/issuers", "LIST")).data
      ?.keys;
    if (Array.isArray(keys) && keys.every((k) => typeof k === "string"))
      candidates = keys;
  } catch {
    /* Older mounts may expose only the default CA. */
  }
  if (candidates.length > 100)
    return { issuer: null, issuerState: "too_many_issuers" };
  let unavailable = false;
  for (const ref of candidates.length ? candidates : ["default"]) {
    try {
      const data = ref === "default" ? null : (await adapter.request(
        source.path + "/issuer/" + encodeURIComponent(ref), "GET", undefined, 1024 * 1024,
      )).data;
      const certificate = data?.certificate ?? await adapter.pem(source, "ca");
      const ca = new X509Certificate(certificate);
      if (matches(ca)) {
        let candidates = Array.isArray(data?.ca_chain) ? data.ca_chain.filter((p: unknown): p is string => typeof p === "string") : [];
        if (!candidates.length) {
          try {
            const response = await adapter.request(source.path + "/ca_chain", "GET", undefined, 1024 * 1024);
            if (typeof response === "string") candidates = [response];
          } catch { /* Export remains unavailable if the signing chain cannot be read. */ }
        }
        return {
          issuer: { pem: certificate as string, subject: ca.subject, ref },
          issuerState: "verified",
          chain: assembleChain(pem, [certificate, ...candidates]),
        };
      }
    } catch {
      unavailable = true;
    }
  }
  return {
    issuer: null,
    issuerState: unavailable ? "unavailable" : "unresolved",
  };
}
