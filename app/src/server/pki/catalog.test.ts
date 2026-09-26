import { test } from "node:test";
import { DatabaseSync } from "node:sqlite";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { createServer } from "node:http";
import { PkiStore } from "./store.js";
import { PkiAdapter } from "./adapter.js";
import { validateQuery } from "./query.js";
import { parseCertificate, parseSans } from "./certificate.js";
import { collectPki } from "./worker.js";
import type { PkiSource } from "../../shared/pki.js";

test("catalog scopes OR searches, escapes wildcards, paginates and preserves identity", () => {
  const dir = mkdtempSync(join(tmpdir(), "pki-test-")),
    store = new PkiStore(join(dir, "catalog.sqlite"));
  try {
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
        join(dir, "cert.pem"),
        "-subj",
        "/CN=api.example.test",
        "-days",
        "1",
        "-addext",
        "subjectAltName=DNS:other.example.test,IP:127.0.0.1",
      ],
      { stdio: "ignore" },
    );
    const pem = readFileSync(join(dir, "cert.pem"), "utf8");
    for (const id of ["allowed", "hidden"])
      store.source({
        id,
        cluster: "test",
        namespace: "",
        accessor: id,
        path: id,
        description: "",
        coverage: "not_collected",
        lastCollected: null,
      });
    store.save("allowed", pem, "unknown");
    store.save("hidden", pem, "revoked");
    const query = (
      conditions: unknown[] = [],
      match = "all",
      sources = ["allowed"],
    ) => validateQuery({ sources, conditions, match, sort: "cn", limit: 1 });
    assert.equal(
      store.query(
        query(
          [
            { field: "cn", operator: "contains", value: "api" },
            { field: "cn", operator: "contains", value: "example" },
          ],
          "any",
        ),
      ).total,
      1,
    );
    assert.equal(
      store.query(
        query([{ field: "san_dns", operator: "contains", value: "api" }]),
      ).total,
      0,
    );
    assert.equal(
      store.query(
        query([
          { field: "san_dns", operator: "equals", value: "OTHER.example.test" },
        ]),
      ).total,
      1,
    );
    assert.equal(
      store.query(query([{ field: "cn", operator: "contains", value: "%" }]))
        .total,
      0,
    );
    assert.equal(store.query(query([], "all", [])).total, 0);
    const all = query([], "all", ["allowed", "hidden"]),
      first = store.query(all);
    assert.ok(first.nextCursor);
    const second = store.query({ ...all, cursor: first.nextCursor });
    assert.notEqual(first.certificates[0].id, second.certificates[0].id);
    assert.equal(second.nextCursor, null);
    assert.deepEqual(first.summary, second.summary);
    const jumped = store.query(validateQuery({ ...all, offset: 1 }));
    assert.deepEqual(jumped.certificates, second.certificates);
    assert.deepEqual(jumped.summary, first.summary);
    assert.equal(jumped.total, first.total);
    assert.equal(store.query({ ...query(), offset: 1 }).certificates.length, 0);
    for (const offset of [-1, 0.5, "1", Number.MAX_SAFE_INTEGER + 1])
      assert.throws(() => validateQuery({ ...all, offset }), /offset/);
    assert.throws(() => validateQuery({ ...all, offset: 1, cursor: first.nextCursor }), /either/);
    assert.equal(first.summary?.revoked, 1);
    assert.equal(store.query(query()).summary?.revoked, 0);
    assert.equal(store.query(query()).summary?.critical, 1);
    assert.equal(store.query(query([{ field: "cn", operator: "equals", value: "missing" }])).summary?.critical, 0);
    assert.equal(store.query(query([], "all", [])).summary?.revoked, 0);
    const expiry = Number(store.db.prepare("SELECT notAfter FROM certificates LIMIT 1").get()!.notAfter);
    const day = 86400000;
    assert.equal(store.query(query(), true, expiry - 8 * day).summary?.warning, 1);
    assert.equal(store.query(query(), true, expiry - 31 * day).summary?.near, 1);
    assert.equal(store.query(query(), true, expiry - 91 * day).summary?.later, 1);
    assert.equal(store.query(query(), true, expiry + 1).summary?.expired, 1);

    assert.throws(
      () => store.query({ ...query(), cursor: first.nextCursor! }),
      /Cursor/,
    );
    const hidden =
      second.certificates[0].sourceId === "hidden"
        ? second.certificates[0]
        : first.certificates[0];
    assert.equal(store.certificate(hidden.id, ["allowed"]), null);
    assert.throws(
      () => store.save("allowed", pem, "revoked", "bad"),
      /mismatch/,
    );
    assert.equal(store.query(query()).certificates[0].revoked, "unknown");
    assert.throws(() =>
      validateQuery({
        sources: [],
        conditions: [{ field: "constructor", operator: "equals", value: "x" }],
      }),
    );
    assert.throws(() =>
      validateQuery({
        sources: [],
        conditions: [{ field: "serial", operator: "equals", value: "xyz" }],
      }),
    );
    assert.deepEqual(
      parseSans(
        'DNS:example.test, URI:"https://example.test/a,b", IP Address:127.0.0.1',
      ),
      [
        { type: "dns", value: "example.test" },
        { type: "uri", value: "https://example.test/a,b" },
        { type: "ip", value: "127.0.0.1" },
      ],
    );
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("worker persists progress, marks unknown revocation and pauses on lost access", async () => {
  const dir = mkdtempSync(join(tmpdir(), "pki-worker-")),
    dbPath = join(dir, "catalog.sqlite"),
    store = new PkiStore(dbPath);
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
      join(dir, "cert.pem"),
      "-subj",
      "/CN=worker.test",
      "-days",
      "1",
    ],
    { stdio: "ignore" },
  );
  const pem = readFileSync(join(dir, "cert.pem"), "utf8"),
    serial = parseCertificate(pem).serial;
  let allowed = true,
    reads = 0;
  let holdNext = false,
    notifyHeld: () => void = () => {},
    releaseHeld: () => void = () => {};
  const server = createServer((req, res) => {
    res.setHeader("Content-Type", "application/json");
    const path = req.url!.split("?")[0];
    if (path.includes("/sys/health"))
      res.end(JSON.stringify({ cluster_id: "test" }));
    else if (path.endsWith("/auth/token/lookup-self")) res.end('{"data":{}}');
    else if (path.endsWith("/sys/mounts"))
      res.end('{"data":{"pki/":{"type":"pki","accessor":"accessor"}}}');
    else if (path.endsWith("/sys/capabilities-self"))
      res.end(JSON.stringify({ "pki/certs": [allowed ? "list" : "deny"] }));
    else if (path.endsWith("/certs/revoked")) {
      res.statusCode = 403;
      res.end("{}");
    } else if (path.endsWith("/certs"))
      res.end(JSON.stringify({ data: { keys: [serial] } }));
    else if (path.includes("/cert/")) {
      reads++;
      if (holdNext) {
        holdNext = false;
        releaseHeld = () =>
          res.end(JSON.stringify({ data: { certificate: pem } }));
        notifyHeld();
      } else res.end(JSON.stringify({ data: { certificate: pem } }));
    } else {
      res.statusCode = 404;
      res.end("{}");
    }
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const address = `http://127.0.0.1:${(server.address() as { port: number }).port}`,
    adapter = new PkiAdapter(address, "test-token");
  try {
    const source = (await adapter.discover())[0];
    store.source(source);
    const input = {
      id: store.createJob([source.id]),
      dbPath,
      address,
      token: "test-token",
      namespace: "",
      skipTls: false,
      concurrency: 2,
      requestsPerSecond: 10000,
    };
    await collectPki({ ...input, attempt: store.dispatch(input.id) });
    assert.equal(store.job(input.id)!.status, "partial");
    assert.equal(
      store.job(input.id)!.completed,
      1,
      JSON.stringify(store.db.prepare("SELECT * FROM job_items").all()),
    );
    assert.equal(store.sources([source.id])[0].coverage, "revocation_unknown");
    store.state(input.id, "queued");
    await collectPki({ ...input, attempt: store.dispatch(input.id) });
    assert.equal(reads, 2);
    allowed = false;
    const denied = { ...input, id: store.createJob([source.id]) };
    await collectPki({ ...denied, attempt: store.dispatch(denied.id) });
    assert.equal(store.job(denied.id)!.status, "paused");
    assert.equal(reads, 2);
    const paused = { ...input, id: store.createJob([source.id]) };
    const attempt = store.dispatch(paused.id);
    store.pause(paused.id);
    await collectPki({ ...paused, attempt });
    assert.equal(store.job(paused.id)!.status, "paused");
    allowed = true;
    const delayed = { ...input, id: store.createJob([source.id]) };
    const held = new Promise<void>((resolve) => {
      notifyHeld = resolve;
    });
    holdNext = true;
    const oldRun = collectPki({
      ...delayed,
      attempt: store.dispatch(delayed.id),
    });
    await held;
    store.db
      .prepare("UPDATE jobs SET updatedAt=? WHERE id=?")
      .run("2000-01-01", delayed.id);
    store.recover();
    store.resume(delayed.id);
    await collectPki({ ...delayed, attempt: store.dispatch(delayed.id) });
    const observation = store.db
      .prepare("SELECT lastSeen FROM certificates WHERE sourceId=?")
      .get(source.id)!.lastSeen;
    releaseHeld();
    await oldRun;
    assert.equal(
      store.db
        .prepare("SELECT lastSeen FROM certificates WHERE sourceId=?")
        .get(source.id)!.lastSeen,
      observation,
    );
    assert.equal(store.job(delayed.id)!.status, "partial");
    assert.equal(
      store.jobDetails(delayed.id, [source.id])!.sources[0].revocationMode,
      "certificate_metadata",
    );
  } finally {
    releaseHeld();
    server.closeAllConnections();
    await new Promise<void>((r) => server.close(() => r()));
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("attempt ownership fences late writers, heartbeats and completion across connections", () => {
  const dir = mkdtempSync(join(tmpdir(), "pki-lease-")),
    path = join(dir, "db.sqlite");
  const old = new PkiStore(path),
    control = new PkiStore(path),
    next = new PkiStore(path);
  try {
    const source = {
      id: "source",
      cluster: "test",
      namespace: "",
      accessor: "a",
      path: "pki",
      description: "",
      coverage: "not_collected",
      lastCollected: null,
    };
    control.source(source);
    const id = control.createJob([source.id]),
      attempt = control.dispatch(id);
    assert.equal(old.claim(id, attempt), true);
    assert.equal(next.claim(id, attempt), false);
    control.db
      .prepare("UPDATE jobs SET updatedAt=? WHERE id=?")
      .run("2000-01-01", id);
    control.recover();
    assert.equal(old.heartbeat(id, attempt), 0);
    control.resume(id);
    assert.throws(() => control.resume(id), /resumed/);
    const resumed = control.dispatch(id);
    assert.equal(next.claim(id, resumed), true);
    assert.throws(
      () =>
        old.transaction(() =>
          old.source({ ...source, description: "stale overwrite" }),
        ),
      /no longer owns/,
    );
    old.finish(id, attempt, "completed");
    assert.equal(control.job(id)!.status, "running");
    assert.equal(control.sources([source.id])[0].description, "");
    next.transaction(() =>
      next.source({ ...source, description: "current writer" }),
    );
    control.pause(id);
    assert.throws(
      () =>
        next.transaction(() =>
          next.source({ ...source, description: "write after pause" }),
        ),
      /no longer owns/,
    );
    next.finish(id, resumed, "completed");
    assert.equal(control.job(id)!.status, "paused");
    assert.equal(control.sources([source.id])[0].description, "current writer");
    assert.throws(() => control.createJob(["missing-source"]));
  } finally {
    old.close();
    control.close();
    next.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("job diagnostics are scoped and error samples are bounded", () => {
  const dir = mkdtempSync(join(tmpdir(), "pki-details-")),
    s = new PkiStore(join(dir, "db.sqlite"));
  try {
    s.source({
      id: "s",
      cluster: "test",
      namespace: "ns",
      accessor: "a",
      path: "pki",
      description: "",
      coverage: "not_collected",
      lastCollected: null,
    });
    const id = s.createJob(["s"]);
    s.enqueue(
      id,
      "s",
      Array.from({ length: 30 }, (_, i) => i.toString(16)),
      null,
    );
    s.db
      .prepare(
        "UPDATE job_items SET state='failed',error='Vault resource not found',errorCategory='not_found' WHERE jobId=?",
      )
      .run(id);
    const details = s.jobDetails(id, ["s"], 5)!;
    assert.equal(details.sources[0].failed, 30);
    assert.equal(details.errors.length, 5);
    assert.equal(details.errorsTruncated, true);
    assert.equal(s.jobDetails(id, []), null);
    assert.equal(s.jobDetails("missing", ["s"]), null);
    s.close();
    const reopened = new PkiStore(join(dir, "db.sqlite"));
    assert.equal(reopened.jobDetails(id, ["s"])!.job.total, 30);
    reopened.close();
  } finally {
    try {
      s.close();
    } catch {}
    rmSync(dir, { recursive: true, force: true });
  }
});

test("schema upgrade retains v1 jobs and refuses an active legacy worker", () => {
  const dir = mkdtempSync(join(tmpdir(), "pki-upgrade-")),
    path = join(dir, "db.sqlite");
  const db = new DatabaseSync(path);
  db.exec(`CREATE TABLE pki_schema(version INTEGER PRIMARY KEY);INSERT INTO pki_schema VALUES(1);
    CREATE TABLE jobs(id TEXT PRIMARY KEY,sources TEXT NOT NULL,status TEXT NOT NULL,createdAt TEXT NOT NULL,updatedAt TEXT NOT NULL,error TEXT,pid INTEGER);
    INSERT INTO jobs VALUES('legacy','[]','running','2026-09-13','2026-09-13',NULL,NULL);`);
  try {
    assert.throws(() => new PkiStore(path), /Stop legacy PKI workers/);
    assert.equal(
      db.prepare("SELECT version FROM pki_schema").get()!.version,
      1,
    );
    db.exec("UPDATE jobs SET status='completed'");
    const upgraded = new PkiStore(path);
    assert.equal(upgraded.job("legacy")!.status, "completed");
    assert.equal(
      upgraded.db.prepare("SELECT version FROM pki_schema").get()!.version,
      3,
    );
    upgraded.close();
    db.exec("UPDATE pki_schema SET version=4");
    assert.throws(() => new PkiStore(path), /Unsupported PKI database schema/);
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
