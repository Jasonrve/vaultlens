import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { createServer } from "node:http";
import { PkiStore, CertificateConflict } from "./store.js";
import { PkiAdapter } from "./adapter.js";
import { parseCertificate } from "./certificate.js";
import { collectPki } from "./worker.js";
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "pki-identity-"));
  function certificate(name: string) {
    const file = join(dir, name + ".pem");
    execFileSync(
      "openssl",
      [
        "req",
        "-x509",
        "-newkey",
        "rsa:2048",
        "-nodes",
        "-keyout",
        join(dir, "key.pem"),
        "-out",
        file,
        "-subj",
        "/CN=" + name + ".test",
        "-set_serial",
        "1",
        "-days",
        "1",
      ],
      { stdio: "ignore" },
    );
    return readFileSync(file, "utf8");
  }
  return { dir, certificate };
}
test("conflicting serial preserves original data and records deduplicated evidence", () => {
  const f = fixture(),
    s = new PkiStore(join(f.dir, "db.sqlite"));
  try {
    const first = f.certificate("original"),
      second = f.certificate("conflicting");
    s.source({
      id: "s",
      cluster: "c",
      namespace: "",
      accessor: "a",
      path: "pki",
      description: "",
      coverage: "not_collected",
      lastCollected: null,
    });
    s.save("s", first, "not_revoked");
    const before = s.db.prepare("SELECT * FROM certificates").get();
    let completed = false;
    for (let i = 0; i < 2; i++)
      assert.throws(
        () =>
          s.save("s", second, "revoked", "1", () => {
            completed = true;
          }),
        CertificateConflict,
      );
    assert.equal(completed, false);
    assert.deepEqual(s.db.prepare("SELECT * FROM certificates").get(), before);
    const evidence = s.conflicts("s", "1").observations;
    assert.equal(evidence.length, 1);
    assert.equal(evidence[0].observations, 2);
    assert.equal(
      evidence[0].expectedFingerprint,
      parseCertificate(first).fingerprint,
    );
    assert.equal(
      evidence[0].observedFingerprint,
      parseCertificate(second).fingerprint,
    );
    assert.equal(
      parseCertificate(s.pem(String(evidence[0].observedFingerprint))!)
        .fingerprint,
      parseCertificate(second).fingerprint,
    );
    assert.throws(() => s.save("s", second, "revoked", "2"), /mismatch/);
    assert.equal(s.conflicts("s", "1").observations[0].observations, 2);
    s.save("s", first, "revoked");
    assert.equal(
      s.db.prepare("SELECT revoked FROM certificates").get()!.revoked,
      "revoked",
    );
  } finally {
    s.close();
    rmSync(f.dir, { recursive: true, force: true });
  }
});

test("source changes discard an in-flight batch; remount can resume and conflicts are reported", async () => {
  const f = fixture(),
    path = join(f.dir, "db.sqlite"),
    s = new PkiStore(path);
  const pem = f.certificate("original"),
    other = f.certificate("conflicting");
  let cluster = "cluster",
    accessor = "accessor",
    mount = "pki",
    allowed = true,
    body = pem;
  let change: () => void = () => {};
  const server = createServer((req, res) => {
    const url = req.url!.split("?")[0];
    res.setHeader("Content-Type", "application/json");
    if (url === "/v1/sys/health")
      res.end(JSON.stringify({ cluster_id: cluster }));
    else if (url === "/v1/sys/mounts")
      res.end(
        JSON.stringify({ data: { [mount + "/"]: { type: "pki", accessor } } }),
      );
    else if (url === "/v1/sys/capabilities-self")
      res.end(
        JSON.stringify({ [mount + "/certs"]: [allowed ? "list" : "deny"] }),
      );
    else if (url === "/v1/auth/token/lookup-self") res.end('{"data":{}}');
    else if (url.endsWith("/certs/revoked")) res.end('{"data":{"keys":[]}}');
    else if (url.endsWith("/certs")) res.end('{"data":{"keys":["01"]}}');
    else if (url.endsWith("/cert/01")) {
      change();
      res.end(
        JSON.stringify({ data: { certificate: body, revocation_time: 0 } }),
      );
    } else {
      res.statusCode = 404;
      res.end("{}");
    }
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const address = `http://127.0.0.1:${(server.address() as { port: number }).port}`,
    adapter = new PkiAdapter(address, "fixture-token");
  const input = (id: string) => ({
    id,
    attempt: s.dispatch(id),
    dbPath: path,
    address,
    token: "fixture-token",
    namespace: "",
    skipTls: false,
    concurrency: 2,
    requestsPerSecond: 10000,
  });
  try {
    const source = (await adapter.discover())[0];
    s.source(source);
    for (const mutate of [
      () => {
        mount = "moved";
      },
      () => {
        accessor = "replacement";
      },
      () => {
        cluster = "other";
      },
      () => {
        allowed = false;
      },
    ]) {
      cluster = "cluster";
      accessor = "accessor";
      mount = "pki";
      allowed = true;
      change = mutate;
      const id = s.createJob([source.id]);
      await collectPki(input(id));
      assert.equal(s.job(id)!.status, "paused");
      assert.equal(s.job(id)!.completed, 0);
      assert.equal(
        s.db.prepare("SELECT COUNT(*) AS n FROM certificates").get()!.n,
        0,
      );
      assert.equal(
        s.jobDetails(id, [source.id])!.sources[0].errorCategory,
        "source_changed",
      );
    }
    allowed = true;
    cluster = "cluster";
    accessor = "accessor";
    mount = "pki";
    change = () => {
      mount = "moved";
    };
    const id = s.createJob([source.id]);
    await collectPki(input(id));
    change = () => {};
    s.resume(id);
    await collectPki(input(id));
    assert.equal(s.job(id)!.status, "completed");
    assert.equal(s.sources([source.id])[0].path, "moved");
    const namespaceSource = (
      await new PkiAdapter(
        address,
        "fixture-token",
        "other-namespace",
      ).discover()
    )[0];
    assert.notEqual(namespaceSource.id, source.id);
    accessor = "replacement";
    const replacement = (await adapter.discover())[0];
    assert.notEqual(replacement.id, source.id);
    assert.equal(s.certificate(1, [replacement.id]), null);
    accessor = "accessor";
    // Bulk revocation is available, but a refresh must still observe a replaced body.
    body = other;
    const conflictJob = s.createJob([source.id]);
    await collectPki(input(conflictJob));
    assert.equal(s.job(conflictJob)!.status, "partial");
    assert.equal(s.job(conflictJob)!.failed, 1);
    assert.equal(
      s.jobDetails(conflictJob, [source.id])!.errors[0].errorCategory,
      "identity_conflict",
    );
    assert.equal(
      s.db.prepare("SELECT fingerprint FROM certificates").get()!.fingerprint,
      parseCertificate(pem).fingerprint,
    );
    assert.equal(
      s.conflicts(source.id, "1").observations[0].lastJobId,
      conflictJob,
    );
  } finally {
    server.closeAllConnections();
    await new Promise<void>((r) => server.close(() => r()));
    s.close();
    rmSync(f.dir, { recursive: true, force: true });
  }
});

test("v2 upgrade keeps source data and creates an empty conflict history", () => {
  const f = fixture(),
    path = join(f.dir, "db.sqlite"),
    s = new PkiStore(path);
  s.source({
    id: "s",
    cluster: "c",
    namespace: "",
    accessor: "a",
    path: "pki",
    description: "",
    coverage: "not_collected",
    lastCollected: null,
  });
  s.db.exec("DROP TABLE certificate_conflicts;UPDATE pki_schema SET version=2");
  s.close();
  try {
    const upgraded = new PkiStore(path);
    assert.equal(upgraded.sources(["s"]).length, 1);
    assert.equal(upgraded.conflicts("s", "1").observations.length, 0);
    assert.equal(
      upgraded.db.prepare("SELECT MAX(version) AS v FROM pki_schema").get()!.v,
      3,
    );
    upgraded.close();
  } finally {
    rmSync(f.dir, { recursive: true, force: true });
  }
});
