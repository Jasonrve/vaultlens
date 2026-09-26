import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync, fork } from "node:child_process";
import { PkiStore } from "./store.js";
import { PkiAdapter } from "./adapter.js";
import { collectPki } from "./worker.js";

test("collection retries transient failures, preserves evidence on partial reads, and recovers a terminated worker", async () => {
  const dir = mkdtempSync(join(tmpdir(), "pki-recovery-")),
    path = join(dir, "db");
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
      join(dir, "pem"),
      "-subj",
      "/CN=fixture",
      "-set_serial",
      "1",
      "-days",
      "1",
    ],
    { stdio: "ignore" },
  );
  const pem = readFileSync(join(dir, "pem"), "utf8");
  let mode = "ok",
    reads = 0,
    listReads = 0,
    onRead = () => {};
  const server = createServer((req, res) => {
    const url = req.url!.split("?")[0];
    res.setHeader("Content-Type", "application/json");
    if (url === "/v1/auth/token/lookup-self") res.end('{"data":{}}');
    else if (url === "/v1/sys/health") res.end('{"cluster_id":"fixture"}');
    else if (url === "/v1/sys/mounts")
      res.end('{"data":{"pki/":{"type":"pki","accessor":"a"}}}');
    else if (url === "/v1/sys/capabilities-self")
      res.end('{"pki/certs":["list"]}');
    else if (url.endsWith("/certs/revoked")) res.end('{"data":{"keys":[]}}');
    else if (url.endsWith("/certs")) {
      listReads++;
      if (mode === "list503") {
        res.statusCode = 503;
        res.end("{}");
      } else res.end('{"data":{"keys":["01"]}}');
    } else if (url.endsWith("/cert/01")) {
      reads++;
      onRead();
      if (mode === "hold") return;
      const status =
        mode === "missing"
          ? 404
          : mode === "denied"
            ? 403
            : mode === "unauthorized"
              ? 401
              : mode === "429" && reads === 1
                ? 429
                : mode === "503" && reads === 1
                  ? 503
                  : 200;
      res.statusCode = status;
      res.end(
        status !== 200
          ? "{}"
          : JSON.stringify({
              data: {
                certificate: mode === "malformed" ? "invalid" : pem,
                revocation_time: 0,
              },
            }),
      );
    } else {
      res.statusCode = 404;
      res.end("{}");
    }
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const address = `http://127.0.0.1:${(server.address() as { port: number }).port}`,
    store = new PkiStore(path),
    source = (await new PkiAdapter(address, "fixture").discover())[0];
  store.source(source);
  const input = (id: string) => ({
    id,
    attempt: store.dispatch(id),
    dbPath: path,
    address,
    token: "fixture",
    namespace: "",
    skipTls: false,
    concurrency: 2,
    requestsPerSecond: 10000,
  });
  try {
    for (const scenario of [
      "ok",
      "429",
      "503",
      "missing",
      "malformed",
      "denied",
      "unauthorized",
      "list503",
    ]) {
      mode = scenario;
      reads = 0;
      listReads = 0;
      const id = store.createJob([source.id]);
      await collectPki(input(id));
      const status = ["ok", "429", "503"].includes(mode)
        ? "completed"
        : ["denied", "unauthorized"].includes(mode)
          ? "paused"
          : "partial";
      assert.equal(store.job(id)!.status, status, mode);
      if (["429", "503"].includes(mode)) assert.equal(reads, 2);
      if (mode === "list503") assert.equal(listReads, 4);
      assert.equal(
        store.db.prepare("SELECT presence FROM certificates").get()!.presence,
        "present",
      );
      if (["missing", "malformed"].includes(mode))
        assert.equal(store.job(id)!.failed, 1);
    }
    mode = "hold";
    const id = store.createJob([source.id]),
      payload = input(id);
    let observed!: () => void;
    const waiting = new Promise<void>((r) => (observed = r));
    onRead = observed;
    const child = fork(new URL("./worker.js", import.meta.url), [], {
      stdio: ["ignore", "ignore", "ignore", "ipc"],
    });
    child.send(payload);
    await Promise.race([
      waiting,
      new Promise((_, reject) =>
        setTimeout(() => reject(Error("Worker did not start")), 10000).unref(),
      ),
    ]);
    const exited = new Promise<void>((r) => child.once("exit", () => r()));
    child.kill("SIGKILL");
    await exited;
    store.db
      .prepare("UPDATE jobs SET updatedAt=? WHERE id=?")
      .run(new Date(Date.now() - 180000).toISOString(), id);
    store.recover();
    assert.equal(store.job(id)!.status, "interrupted");
    mode = "ok";
    onRead = () => {};
    store.resume(id);
    await collectPki(input(id));
    assert.equal(store.job(id)!.status, "completed");
  } finally {
    server.closeAllConnections();
    await new Promise<void>((r) => server.close(() => r()));
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
