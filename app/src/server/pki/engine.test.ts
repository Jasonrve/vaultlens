import { test } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { createServer } from "node:http";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { pkiEngineUrl } from "../../shared/pkiEngine.js";
test("PKI engine reads roles without certificate LIST, scopes references and fences replacement mounts", async () => {
  const dir = mkdtempSync(join(tmpdir(), "pki-engine-"));
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
  let accessor = "a",
    replace = false,
    denyCertificate = false,
    denyRoles = false;
  const calls: string[] = [];
  const vault = createServer((req, res) => {
    const path = req.url!.split("?")[0];
    calls.push(path);
    res.setHeader("Content-Type", "application/json");
    if (path === "/v1/auth/token/lookup-self") {
      if (req.headers["x-vault-token"] === "expired") res.statusCode = 403;
      res.end('{"data":{}}');
    } else if (path === "/v1/sys/health") res.end('{"cluster_id":"c"}');
    else if (path === "/v1/sys/mounts")
      res.end(
        JSON.stringify({ data: { "team/pki/": { type: "pki", accessor } } }),
      );
    else if (path === "/v1/team/pki/roles") {
      if (denyRoles) {
        res.statusCode = 403;
        res.end("{}");
      } else res.end(JSON.stringify({data:{keys:["server", ...Array.from({length:110}, (_, i) => "role-" + i), "tail-role"]}}));
    } else if (path === "/v1/team/pki/roles/server") {
      if (replace) accessor = "b";
      res.end('{"data":{"issuer_ref":"issuer-a","allowed_domains":["test"]}}');
    } else if (path === "/v1/team/pki/issuers")
      res.end(
        '{"data":{"keys":["issuer-a"],"key_info":{"issuer-a":{"issuer_name":"CA"}}}}',
      );
    else if (path === "/v1/team/pki/issuer/issuer-a")
      res.end(
        JSON.stringify({ data: { certificate: pem, issuer_id: "issuer-a" } }),
      );
    else if (path === "/v1/team/pki/certs") {
      res.statusCode = 403;
      res.end("{}");
    } else if (path === "/v1/team/pki/cert/01") {
      if (denyCertificate) {
        res.statusCode = 403;
        res.end("{}");
      } else
        res.end(
          JSON.stringify({ data: { certificate: pem, revocation_time: 0 } }),
        );
    } else {
      res.statusCode = 404;
      res.end("{}");
    }
  });
  await new Promise<void>((r) => vault.listen(0, "127.0.0.1", r));
  process.env.VAULT_ADDR = `http://127.0.0.1:${(vault.address() as { port: number }).port}`;
  const app = express();
  app.use(express.json());
  app.use("/engine", (await import("../routes/pkiEngine.js")).default);
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((r) => server.once("listening", r));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}/engine?mount=team%2Fpki`;
  const get = (query = "", token = "fixture") =>
    fetch(base + query, {
      headers: token ? { Authorization: "Bearer " + token } : {},
    });
  try {
    assert.equal((await get("", "")).status, 401);
    assert.equal((await get("", "expired")).status, 403);
    const root = (await (await get()).json()) as any;
    assert.equal(root.source.path, "team/pki");
    assert.equal((await get("&section=roles")).status, 200);
    const lookup = await (await get("&section=roles&lookup=true&query=TAIL-ROLE")).json() as any;
    assert.deepEqual(lookup.items.map((item:any) => item.id), ["tail-role"]);
    assert.equal(lookup.total, 1);
    const emptyLookup = await (await get("&section=roles&lookup=true&query=missing")).json() as any;
    assert.equal(emptyLookup.total, 0);
    const issuerLookup = await (await get("&section=issuers&lookup=true&query=ca")).json() as any;
    assert.equal(issuerLookup.items[0].id, "issuer-a");
    assert.equal((await get("&section=roles&ref=server")).status, 200);
    assert.equal(calls.includes("/v1/sys/capabilities-self"), false);
    assert.equal((await get("&section=issuers")).status, 200);
    assert.equal((await get("&section=issuers&ref=issuer-a")).status, 200);
    assert.equal((await get("&section=certificates")).status, 403);
    const certificate = (await (
      await get("&section=certificate&ref=00:01")
    ).json()) as any;
    assert.equal(certificate.certificate.serial, "1");
    assert.equal(certificate.revocation, "not_revoked");
    assert.equal("der" in certificate.certificate, false);
    denyCertificate = true;
    assert.equal((await get("&section=certificate&ref=1")).status, 403);
    denyCertificate = false;
    denyRoles = true;
    assert.equal((await get("&section=roles")).status, 403);
    assert.equal((await get("&section=roles&lookup=true&query=server")).status, 403);
    denyRoles = false;
    assert.equal((await get("&section=roles&ref=..%2Fsecret")).status, 400);
    assert.equal((await get("&section=unsupported")).status, 400);
    assert.equal((await get("&source=old")).status, 409);
    const post = (body: Record<string, unknown>, token = "fixture") =>
      fetch(base, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + token,
        },
        body: JSON.stringify({
          mount: "team/pki",
          source: root.source.id,
          action: "role-save",
          ref: "server",
          fields: { allowed_domains: ["test"] },
          ...body,
        }),
      });
    assert.equal((await post({})).status, 200);
    assert.equal((await post({}, "expired")).status, 403);
    assert.equal((await post({ source: "old" })).status, 409);
    assert.equal((await post({ ref: "../sys" })).status, 400);
    assert.equal((await post({ action: "toString" })).status, 400);
    assert.equal((await post({ fields: { unknown: true } })).status, 400);
    assert.equal(
      (await post({ fields: { allow_any_name: "true" } })).status,
      400,
    );
    assert.equal(
      (await post({ action: "role-delete", fields: {} })).status,
      400,
    );
    assert.equal(
      (await post({ action: "role-delete", fields: {}, confirm: "team/pki" }))
        .status,
      200,
    );
    assert.equal((await get("&section=keys")).status, 200);
    assert.equal((await get("&section=configuration")).status, 200);
    replace = true;
    assert.equal(
      (await get("&section=roles&ref=server&source=" + root.source.id)).status,
      409,
    );
    assert.match(
      pkiEngineUrl("team/pki/", {
        certificate: "01:ff",
        source: "a",
        record: 2,
      }),
      /^\/pki\/engines\/team\/pki\?certificate=01%3Aff&source=a&record=2$/,
    );
  } finally {
    server.closeAllConnections();
    vault.closeAllConnections();
    await Promise.all([
      new Promise<void>((r) => server.close(() => r())),
      new Promise<void>((r) => vault.close(() => r())),
    ]);
    rmSync(dir, { recursive: true, force: true });
  }
});
