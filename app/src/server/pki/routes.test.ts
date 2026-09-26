import { test } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { createServer } from "node:http";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { PkiStore } from "./store.js";
import { PkiAdapter } from "./adapter.js";

test("HTTP authorization covers details, jobs and snapshot export with concurrent writes and lost access", async () => {
  const dir = mkdtempSync(join(tmpdir(), "pki-http-"));
  let allowed = true,
    lookups = 0,
    mutate = () => {},
    revokeAt = Infinity;
  const vault = createServer((req, res) => {
    res.setHeader("Content-Type", "application/json");
    const path = req.url!.split("?")[0];
    if (path === "/v1/auth/token/lookup-self") {
      lookups++;
      mutate();
      if (req.headers["x-vault-token"] === "expired") {
        res.statusCode = 403;
        res.end("{}");
        return;
      }
      if (lookups >= revokeAt) allowed = false;
      res.end('{"data":{}}');
    } else if (path === "/v1/sys/health") res.end('{"cluster_id":"fixture"}');
    else if (path === "/v1/sys/mounts")
      res.end('{"data":{"pki/":{"type":"pki","accessor":"a"}}}');
    else if (path === "/v1/sys/capabilities-self")
      res.end(JSON.stringify({ "pki/certs": [allowed ? "list" : "deny"] }));
    else {
      res.statusCode = 404;
      res.end("{}");
    }
  });
  await new Promise<void>((r) => vault.listen(0, "127.0.0.1", r));
  const address = `http://127.0.0.1:${(vault.address() as { port: number }).port}`;
  process.env.VAULT_ADDR = address;
  process.env.VAULTLENS_PKI_DB_PATH = join(dir, "db.sqlite");
  const store = new PkiStore(process.env.VAULTLENS_PKI_DB_PATH);
  const source = (await new PkiAdapter(address, "fixture").discover())[0];
  store.source(source);
  execFileSync(
    "openssl",
    [
      "req",
      "-x509",
      "-newkey",
      "rsa:2048",
      "-nodes",
      "-keyout",
      join(dir, "key"),
      "-out",
      join(dir, "cert"),
      "-subj",
      "/CN=fixture",
      "-days",
      "1",
    ],
    { stdio: "ignore" },
  );
  store.save(source.id, readFileSync(join(dir, "cert"), "utf8"), "unknown");
  // Synthetic metadata copies exercise multiple export pages; certificate crypto is tested separately.
  const columns = store.db
    .prepare("PRAGMA table_info(certificates)")
    .all()
    .map((r) => String(r.name))
    .filter((n) => n !== "id");
  const copy = store.db.prepare(
    `INSERT INTO certificates (${columns.join(",")}) SELECT ${columns.map((c) => (c === "serial" ? "?" : c)).join(",")} FROM certificates WHERE id=1`,
  );
  for (let i = 0; i < 299; i++) copy.run("fixture-" + i);
  const job = store.createJob([source.id]);
  const app = express();
  app.use(express.json());
  app.use("/api/pki", (await import("../routes/pki.js")).default);
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((r) => server.once("listening", r));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/pki`;
  const q = {
    sources: [source.id],
    conditions: [],
    match: "all",
    sort: "notAfter",
    direction: "asc",
    limit: 50,
  };
  const get = (path: string, token = "fixture") =>
    fetch(base + path, {
      headers: token ? { Authorization: "Bearer " + token } : {},
    });
  const exportPath = "/export?filter=" + encodeURIComponent(JSON.stringify(q));
  const post = (path: string, body: unknown) => fetch(base + path, {
    method: "POST", headers: { Authorization: "Bearer fixture", "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  try {
    assert.equal((await get("/sources", "")).status, 401);
    assert.equal((await get("/sources", "expired")).status, 403);
    assert.equal((await get("/certificates/1")).status, 200);
    assert.equal((await get("/jobs/" + job)).status, 200);
    const selection = await (await post("/selection", q)).json() as {certificates: {id:number;fingerprint:string;sourceId:string;serial:string}[]};
    assert.equal(selection.certificates.length, 300);
    const selectedCertificate = selection.certificates.find(c => c.id === 1)!;
    assert.equal((await post("/batch/item", {action:"remove",certificate:selectedCertificate})).status, 400);
    assert.equal((await post("/batch/item", {action:"remove",certificate:selectedCertificate,confirm:"remove"})).status, 403);
    allowed = false;
    assert.equal((await get("/sources/" + source.id + "/check")).status, 403);
    assert.equal((await post("/selection", q)).status, 403);
    assert.equal((await post("/batch/item", {action:"export",certificate:selectedCertificate})).status, 409);
    assert.equal((await get("/certificates/1")).status, 404);
    assert.equal((await get("/jobs/" + job)).status, 404);
    assert.deepEqual(
      ((await (await get("/jobs")).json()) as { jobs: unknown[] }).jobs,
      [],
    );
    assert.equal((await get(exportPath)).status, 403);
    allowed = true;
    lookups = 0;
    mutate = () => {
      if (lookups === 2) copy.run("concurrent");
    };
    const lines = (await (await get(exportPath)).text())
      .trim()
      .split("\n")
      .map((x) => JSON.parse(x));
    assert.equal(lines[0].consistency, "snapshot");
    assert.equal(lines.at(-1).kind, "complete");
    assert.equal(lines.at(-1).count, 300);
    assert.equal(lines.filter((x) => x.serial === "concurrent").length, 0);
    assert.equal(store.query(q as any).total, 301);
    mutate = () => {};
    const jsonExport = await (await get(exportPath + "&format=json")).json() as any;
    assert.equal(jsonExport.complete, true);
    assert.equal(jsonExport.certificates.length, 301);
    const csvExport = await (await get(exportPath + "&format=csv")).text();
    assert.equal(csvExport.trim().split("\r\n").length, 302);
    assert.ok(csvExport.includes('"sourcePath"'));
    for (const sort of ["cn", "serial", "sourcePath", "type", "notAfter", "revoked"]) {
      for (const direction of ["asc", "desc"]) {
        const query = { ...q, sort, direction } as any;
        const first = store.query(query);
        const second = store.query({ ...query, cursor: first.nextCursor! });
        assert.equal(new Set([...first.certificates, ...second.certificates].map(c => c.id)).size, 100);
      }
    }
    lookups = 0;
    revokeAt = 3;
    const interrupted = (await (await get(exportPath)).text())
      .trim()
      .split("\n")
      .map((x) => JSON.parse(x));
    assert.equal(interrupted.filter((x) => x.id).length, 200);
    assert.equal(interrupted.at(-1).kind, "error");
    assert.equal(
      interrupted.some((x) => x.kind === "complete"),
      false,
    );
    // An abandoned client must release its snapshot; writers remain usable.
    allowed = true;
    revokeAt = Infinity;
    const abort = new AbortController();
    const response = await fetch(base + exportPath, {
      headers: { Authorization: "Bearer fixture" },
      signal: abort.signal,
    });
    await response.body!.getReader().read();
    abort.abort();
    copy.run("after-abort");
    assert.equal(store.query(q as any).total, 302);
  } finally {
    server.closeAllConnections();
    vault.closeAllConnections();
    await Promise.all([
      new Promise<void>((r) => server.close(() => r())),
      new Promise<void>((r) => vault.close(() => r())),
    ]);
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
