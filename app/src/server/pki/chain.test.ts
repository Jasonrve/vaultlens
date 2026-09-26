import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { assembleChain } from "./chain.js";
import { certificatePemOptions } from "../../shared/pkiPem.js";

test("PEM exports retain signature order, exclude roots on request, and reject incomplete chains", () => {
  const dir = mkdtempSync(join(tmpdir(), "pki-chain-"));
  const openssl = (...args: string[]) => execFileSync("openssl", args, { cwd: dir, stdio: "ignore" });
  const read = (name: string) => readFileSync(join(dir, name + ".pem"), "utf8");
  try {
    openssl("req", "-x509", "-newkey", "ec", "-pkeyopt", "ec_paramgen_curve:P-256", "-nodes", "-keyout", "root.key", "-out", "root.pem", "-subj", "/CN=root", "-days", "1", "-addext", "basicConstraints=critical,CA:TRUE");
    let parent = "root";
    for (const name of ["intermediate", "issuing", "leaf"]) {
      openssl("req", "-new", "-newkey", "ec", "-pkeyopt", "ec_paramgen_curve:P-256", "-nodes", "-keyout", name + ".key", "-out", name + ".csr", "-subj", "/CN=" + name);
      writeFileSync(join(dir, "ext"), `basicConstraints=critical,CA:${name === "leaf" ? "FALSE" : "TRUE"}\n`);
      openssl("x509", "-req", "-in", name + ".csr", "-CA", parent + ".pem", "-CAkey", parent + ".key", "-set_serial", "2", "-days", "1", "-extfile", "ext", "-out", name + ".pem");
      parent = name;
    }
    const chain = assembleChain(read("leaf"), [read("root"), read("issuing"), read("intermediate"), read("issuing"), "bad"]);
    assert.equal(chain.state, "complete");
    assert.deepEqual(chain.certificates.map(c => c.subject), ["CN=leaf", "CN=issuing", "CN=intermediate", "CN=root"]);
    const options = certificatePemOptions(read("leaf"), chain);
    assert.deepEqual(options.map(o => o.count), [1, 3, 4, 3, 1, 1]);
    assert.ok(options.every(o => !o.disabled));
    assert.ok(!options[1].pem.includes(read("root").trim()));
    assert.equal(options[3].pem, chain.certificates.slice(1).map(c => c.pem.trim()).join("\n") + "\n");
    writeFileSync(join(dir, "ca-ext"), "basicConstraints=critical,CA:TRUE\n");
    openssl("x509", "-req", "-in", "issuing.csr", "-CA", "intermediate.pem", "-CAkey", "intermediate.key", "-set_serial", "3", "-days", "1", "-extfile", "ca-ext", "-out", "alternate.pem");
    const ambiguous = assembleChain(read("leaf"), [read("issuing"), read("alternate"), read("root"), read("intermediate")]);
    assert.equal(ambiguous.state, "ambiguous");
    const partial = assembleChain(read("leaf"), [read("issuing")]);
    assert.equal(partial.state, "incomplete");
    assert.deepEqual(certificatePemOptions(read("leaf"), partial).map(o => o.disabled), [false, true, true, true, false, true]);
    assert.deepEqual(certificatePemOptions(read("leaf")).map(o => o.disabled), [false, true, true, true, true, true]);
    const root = assembleChain(read("root"), [read("root")]);
    assert.equal(root.certificates.length, 1);
    assert.equal(certificatePemOptions(read("root"), root)[1].disabled, true);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
