import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { PkiStore } from "./store.js";
import { PkiAdapter } from "./adapter.js";
import { batchRef, batchRefs, executeBatchItem, previewBatch } from "./batch.js";
import type { PkiSource } from "../../shared/pki.js";

test("batch actions recheck source access, identity and permissions before mutations", async () => {
  const dir = mkdtempSync(join(tmpdir(), "pki-batch-"));
  const store = new PkiStore(join(dir, "catalog.sqlite"));
  try {
    execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", join(dir,"key"), "-out", join(dir,"cert"), "-subj", "/CN=batch.test", "-days", "1", "-addext", "basicConstraints=critical,CA:FALSE"], { stdio: "ignore" });
    const pem = readFileSync(join(dir,"cert"), "utf8");
    const source: PkiSource = { id:"allowed", cluster:"test", namespace:"", accessor:"test", path:"pki", description:"", coverage:"complete", lastCollected:null };
    store.source(source); store.save(source.id, pem, "not_revoked");
    const ref = batchRef(store.certificate(1, [source.id])!);
    let permission = true, writes = 0, wrongCertificate = false;
    const adapter = {
      request: async (path: string) => {
        if (path === "sys/capabilities-self") return { capabilities: [permission ? "update" : "deny"] };
        if (path === "pki/revoke") { writes++; return {}; }
        throw new Error("Unexpected path");
      },
      assertSource: async () => {},
      certificate: async () => ({ pem: wrongCertificate ? "invalid" : pem, revocation:"not_revoked" }),
    } as unknown as PkiAdapter;
    assert.equal((await previewBatch(store, adapter, [source], false, "revoke", [ref]))[0].eligible, true);
    permission = false;
    await assert.rejects(executeBatchItem(store, adapter, [source], false, "revoke", ref), /permission/);
    permission = true; wrongCertificate = true;
    await assert.rejects(executeBatchItem(store, adapter, [source], false, "revoke", ref));
    wrongCertificate = false;
    await assert.rejects(executeBatchItem(store, adapter, [], true, "remove", ref), /authorized/);
    await assert.rejects(executeBatchItem(store, adapter, [source], false, "remove", ref), /admin/);
    await assert.rejects(executeBatchItem(store, adapter, [source], true, "remove", { ...ref, fingerprint:"0".repeat(64) }), /changed/);
    assert.equal(writes, 0);
    assert.equal((await executeBatchItem(store, adapter, [source], false, "export", ref)).pem, pem);
    await executeBatchItem(store, adapter, [source], false, "revoke", ref);
    assert.equal(writes, 1);
    assert.equal(store.certificate(ref.id, [source.id])!.revoked, "revoked");
    assert.equal((await previewBatch(store, adapter, [source], false, "revoke", [ref]))[0].eligible, false);
    await executeBatchItem(store, adapter, [source], true, "remove", ref);
    assert.equal(store.certificate(ref.id, [source.id]), null);
    assert.equal(store.sources([source.id])[0].coverage, "partial");
    assert.throws(() => batchRefs([ref, ref]), /Duplicate/);
    assert.throws(() => batchRefs([{ ...ref, id:-1 }]), /Invalid/);
  } finally { store.close(); rmSync(dir, { recursive:true, force:true }); }
});
