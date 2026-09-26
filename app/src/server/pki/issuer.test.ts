import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { findIssuer } from "./issuer.js";
import type { PkiAdapter } from "./adapter.js";
import type { PkiSource } from "../../shared/pki.js";

test("issuer discovery verifies the rotated signing CA despite unreadable and unrelated candidates", async () => {
  const dir = mkdtempSync(join(tmpdir(), "pki-issuer-"));
  const openssl = (args: string[]) =>
    execFileSync("openssl", args, { cwd: dir, stdio: "ignore" });
  try {
    for (const name of ["old", "new"])
      openssl([
        "req",
        "-x509",
        "-newkey",
        "rsa:2048",
        "-nodes",
        "-keyout",
        name + ".key",
        "-out",
        name + ".pem",
        "-subj",
        "/CN=" + name,
        "-days",
        "1",
        "-addext",
        "basicConstraints=critical,CA:TRUE",
      ]);
    openssl([
      "req",
      "-new",
      "-newkey",
      "rsa:2048",
      "-nodes",
      "-keyout",
      "leaf.key",
      "-out",
      "leaf.csr",
      "-subj",
      "/CN=leaf",
    ]);
    writeFileSync(join(dir, "ext"), "basicConstraints=CA:FALSE\n");
    openssl([
      "x509",
      "-req",
      "-in",
      "leaf.csr",
      "-CA",
      "new.pem",
      "-CAkey",
      "new.key",
      "-set_serial",
      "1",
      "-days",
      "1",
      "-extfile",
      "ext",
      "-out",
      "leaf.pem",
    ]);
    const read = (name: string) =>
      readFileSync(join(dir, name + ".pem"), "utf8");
    let refs = ["missing", "old", "new"],
      unsupported = false;
    const adapter = {
      request: async (path: string) => {
        if (path.endsWith("/issuers")) {
          if (unsupported) throw Error();
          return { data: { keys: refs } };
        }
        const ref = path.split("/").at(-1)!;
        if (ref === "missing") throw Error();
        return { data: { certificate: read(ref) } };
      },
      pem: async () => read("new"),
    } as unknown as PkiAdapter;
    const source = { path: "pki" } as PkiSource;
    assert.equal(
      (await findIssuer(read("leaf"), source, adapter)).issuer?.pem,
      read("new"),
    );
    refs = ["old"];
    assert.equal(
      (await findIssuer(read("leaf"), source, adapter)).issuerState,
      "unresolved",
    );
    refs = ["missing"];
    assert.equal(
      (await findIssuer(read("leaf"), source, adapter)).issuerState,
      "unavailable",
    );
    unsupported = true;
    assert.equal(
      (await findIssuer(read("leaf"), source, adapter)).issuerState,
      "verified",
    );
    unsupported = false;
    refs = Array(101).fill("new");
    assert.equal(
      (await findIssuer(read("leaf"), source, adapter)).issuerState,
      "too_many_issuers",
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
