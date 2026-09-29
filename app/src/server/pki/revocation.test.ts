import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PkiAdapter } from "./adapter.js";
import { PkiStore } from "./store.js";
import { collectPki } from "./worker.js";

test("collection combines positive evidence and never downgrades confirmed revocation", async () => {
  const dir = mkdtempSync(join(tmpdir(), "pki-revocation-"));
  execFileSync("openssl", ["req", "-x509", "-newkey", "ec", "-pkeyopt", "ec_paramgen_curve:P-256", "-nodes", "-keyout", join(dir, "key"), "-out", join(dir, "pem"), "-subj", "/CN=revocation.test", "-set_serial", "1", "-days", "1"], { stdio: "ignore" });
  const pem = readFileSync(join(dir, "pem"), "utf8");
  let listed: string[] | null = [], metadata: number | undefined = 123;
  const calls: string[] = [];
  const vault = createServer((req, res) => {
    const path = req.url!.split("?")[0];
    calls.push(path);
    res.setHeader("Content-Type", "application/json");
    if (path.endsWith("/auth/token/lookup-self")) res.end('{"data":{}}');
    else if (path.endsWith("/sys/health")) res.end('{"cluster_id":"test"}');
    else if (path.endsWith("/sys/mounts")) res.end('{"data":{"pki/":{"type":"pki","accessor":"a"}}}');
    else if (path.endsWith("/sys/capabilities-self")) res.end('{"pki/certs":["list"]}');
    else if (path.endsWith("/certs/revoked")) {
      if (listed === null) { res.statusCode = 403; res.end("{}"); }
      else res.end(JSON.stringify({ data: { keys: listed } }));
    } else if (path.endsWith("/certs")) res.end('{"data":{"keys":["01"]}}');
    else if (path.endsWith("/cert/01")) res.end(JSON.stringify({ data: { certificate: pem, revocation_time: metadata } }));
    else { res.statusCode = 404; res.end("{}"); }
  });
  await new Promise<void>(resolve => vault.listen(0, "127.0.0.1", resolve));
  const address = `http://127.0.0.1:${(vault.address() as { port: number }).port}`;
  const dbPath = join(dir, "catalog.sqlite"), store = new PkiStore(dbPath);
  try {
    const source = (await new PkiAdapter(address, "fixture").discover())[0];
    store.source(source);
    async function collect() {
      const id = store.createJob([source.id]);
      await collectPki({ id, attempt: store.dispatch(id), dbPath, address, token: "fixture", namespace: "", skipTls: false, concurrency: 1, requestsPerSecond: 10000 });
      return store.db.prepare("SELECT revoked,revocationObservedAt FROM certificates WHERE sourceId=?").get(source.id)!;
    }
    // The snapshot omits a certificate revoked before its subsequent individual read.
    const first = await collect();
    assert.ok(calls.indexOf("/v1/pki/certs/revoked") < calls.indexOf("/v1/pki/cert/01"));
    assert.equal(first.revoked, "revoked");
    for (const scenario of [{ list: [], time: 0 }, { list: null, time: undefined }]) {
      listed = scenario.list; metadata = scenario.time;
      assert.deepEqual(await collect(), first, "Older or missing evidence must retain status and evidence timestamp");
    }
    // Also test first observations without relying on the persisted revoked state.
    for (const scenario of [
      { list: ["00:01"], time: 0, expected: "revoked" },
      { list: null, time: 123, expected: "revoked" },
      { list: [], time: 0, expected: "not_revoked" },
      { list: null, time: undefined, expected: "unknown" },
    ]) {
      store.db.prepare("DELETE FROM certificates WHERE sourceId=?").run(source.id);
      listed = scenario.list; metadata = scenario.time;
      assert.equal((await collect()).revoked, scenario.expected);
    }
  } finally {
    vault.closeAllConnections();
    await new Promise<void>(resolve => vault.close(() => resolve()));
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
