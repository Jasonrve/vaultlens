import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  rmSync,
  statSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PkiStore } from "./store.js";
import { copyCatalog, inspectCatalog } from "./maintenance.js";
test("backup includes WAL, restores into a new DB and refuses destructive overwrite", () => {
  const dir = mkdtempSync(join(tmpdir(), "pki-backup-")),
    path = join(dir, "live.sqlite"),
    s = new PkiStore(path);
  try {
    s.source({
      id: "s",
      cluster: "c",
      namespace: "",
      accessor: "a",
      path: "pki",
      description: "original",
      coverage: "not_collected",
      lastCollected: null,
    });
    const backup = join(dir, "backup.sqlite");
    assert.equal(copyCatalog(path, backup).version, 3);
    s.db.prepare("UPDATE sources SET description='newer'").run();
    const restored = join(dir, "restored.sqlite");
    copyCatalog(backup, restored);
    const r = new PkiStore(restored);
    assert.equal(r.sources(["s"])[0].description, "original");
    r.close();
    const bytes = readFileSync(backup);
    assert.throws(() => copyCatalog(path, backup));
    assert.deepEqual(readFileSync(backup), bytes);
    assert.equal(statSync(backup).mode & 0o777, 0o600);
    assert.throws(() => copyCatalog(path, path));
    const corrupt = join(dir, "corrupt");
    writeFileSync(corrupt, "not a database");
    assert.throws(() => inspectCatalog(corrupt));
    assert.throws(() =>
      s.transaction(() => {
        s.db.prepare("UPDATE sources SET description='uncommitted'").run();
        s.db.prepare("INSERT INTO sources(id) VALUES(?)").run("invalid");
      }),
    );
    assert.equal(s.sources(["s"])[0].description, "newer");
  } finally {
    s.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
