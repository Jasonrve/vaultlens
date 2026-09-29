import { X509Certificate } from "node:crypto";
import type { PkiBatchAction, PkiBatchRef, PkiBatchPreview } from "../../shared/pkiBatch.js";
import { pkiBatchLimit } from "../../shared/pkiBatch.js";
import type { PkiSource, CertificateRecord } from "../../shared/pki.js";
import { PkiAdapter, PkiError } from "./adapter.js";
import { PkiStore } from "./store.js";
import { parseCertificate } from "./certificate.js";

export function batchRefs(raw: unknown): PkiBatchRef[] {
  if (!Array.isArray(raw) || !raw.length || raw.length > pkiBatchLimit || raw.some(c =>
    !c || !Number.isSafeInteger(c.id) || c.id < 1 || typeof c.sourceId !== "string" ||
    !/^[a-f0-9]{64}$/.test(c.fingerprint) || typeof c.serial !== "string"))
    throw new PkiError(400, "Invalid certificate selection");
  if (new Set(raw.map(c => c.id)).size !== raw.length) throw new PkiError(400, "Duplicate certificate selection");
  return raw;
}
export function batchAction(raw: unknown): PkiBatchAction {
  if (raw !== "export" && raw !== "revoke" && raw !== "remove") throw new PkiError(400, "Invalid batch action");
  return raw;
}
export function batchRef(c: CertificateRecord): PkiBatchRef {
  return { id: c.id, sourceId: c.sourceId, fingerprint: c.fingerprint, serial: c.serial, cn: c.cn, sourcePath: c.sourcePath };
}
function current(store: PkiStore, ref: PkiBatchRef, sources: PkiSource[]) {
  const c = store.certificate(ref.id, sources.map(s => s.id));
  if (!c || c.sourceId !== ref.sourceId || c.fingerprint !== ref.fingerprint || c.serial !== ref.serial)
    throw new PkiError(409, "Certificate changed, was removed, or is no longer authorized");
  return c;
}
async function canRevoke(adapter: PkiAdapter, path: string) {
  const endpoint = path + "/revoke";
  const result = await adapter.request("sys/capabilities-self", "POST", { paths: [endpoint] });
  const caps = result[endpoint] ?? result.data?.[endpoint] ?? result.capabilities ?? result.data?.capabilities ?? [];
  return Array.isArray(caps) && !caps.includes("deny") && (caps.includes("root") || caps.includes("update"));
}
export async function previewBatch(store: PkiStore, adapter: PkiAdapter, sources: PkiSource[], admin: boolean, action: PkiBatchAction, refs: PkiBatchRef[]): Promise<PkiBatchPreview[]> {
  const capabilities = new Map<string, boolean>();
  const result: PkiBatchPreview[] = [];
  for (const ref of refs) {
    try {
      const c = current(store, ref, sources);
      const source = sources.find(s => s.id === c.sourceId)!;
      if (action === "remove" && !admin) throw new Error("VaultLens admin privileges required");
      if (action === "revoke") {
        if (c.type === "ca") throw new Error("Manage CA revocation in the PKI engine");
        if (c.revoked === "revoked") throw new Error("Already observed as revoked");
        if (store.conflicts(c.sourceId, c.serial).observations.length) throw new Error("Certificate identity conflict");
        if (!capabilities.has(source.id)) capabilities.set(source.id, await canRevoke(adapter, source.path));
        if (!capabilities.get(source.id)) throw new Error("No update permission on " + source.path + "/revoke");
      }
      result.push({ certificate: batchRef(c), eligible: true });
    } catch (e) {
      result.push({ certificate: { ...ref, cn: "", sourcePath: undefined }, eligible: false, reason: e instanceof Error ? e.message : "Not available" });
    }
  }
  return result;
}
export async function executeBatchItem(store: PkiStore, adapter: PkiAdapter, sources: PkiSource[], admin: boolean, action: PkiBatchAction, ref: PkiBatchRef) {
  const c = current(store, ref, sources);
  const source = sources.find(s => s.id === c.sourceId)!;
  if (action === "export") return { status: "exported", pem: store.pem(c.fingerprint) };
  if (action === "remove") {
    if (!admin) throw new PkiError(403, "VaultLens admin privileges required");
    store.transaction(() => {
      current(store, ref, sources);
      store.db.prepare("DELETE FROM certificates WHERE id=? AND fingerprint=?").run(c.id, c.fingerprint);
      store.db.prepare("UPDATE sources SET coverage='partial' WHERE id=?").run(c.sourceId);
    });
    return { status: "removed" };
  }
  const check = (await previewBatch(store, adapter, sources, admin, action, [ref]))[0];
  if (!check.eligible) throw new PkiError(409, check.reason!);
  await adapter.assertSource(source);
  const pem = store.pem(c.fingerprint)!;
  const serial = new X509Certificate(pem).serialNumber.match(/.{1,2}/g)!.join(":");
  const live = await adapter.certificate(source, serial);
  if (parseCertificate(live.pem).fingerprint !== c.fingerprint) throw new PkiError(409, "Live certificate differs from the selected certificate");
  if (live.revocation !== "revoked") await adapter.request(source.path + "/revoke", "POST", { serial_number: serial });
  store.db.prepare("UPDATE certificates SET revoked='revoked',revocationObservedAt=? WHERE id=? AND fingerprint=?")
    .run(new Date().toISOString(), c.id, c.fingerprint);
  return { status: live.revocation === "revoked" ? "already revoked" : "revoked" };
}
