import { DatabaseSync } from "node:sqlite";
import { mkdirSync, mkdtempSync, linkSync, rmSync, chmodSync } from "node:fs";
import { dirname, resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
export function inspectCatalog(path: string) {
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    if (db.prepare("PRAGMA integrity_check").get()!.integrity_check !== "ok")
      throw new Error("SQLite integrity check failed");
    if (db.prepare("PRAGMA foreign_key_check").all().length)
      throw new Error("SQLite foreign key check failed");
    const version = Number(
      db.prepare("SELECT MAX(version) AS version FROM pki_schema").get()!
        .version,
    );
    if (![1, 2, 3].includes(version)) throw new Error("Unsupported PKI schema");
    return {
      version,
      certificates: Number(
        db.prepare("SELECT COUNT(*) AS n FROM certificates").get()!.n,
      ),
      jobs: Number(db.prepare("SELECT COUNT(*) AS n FROM jobs").get()!.n),
    };
  } finally {
    db.close();
  }
}
// Both operations create a new destination; they never overwrite a live database.
// VACUUM INTO copies a consistent committed snapshot including WAL contents.
export function copyCatalog(source: string, target: string) {
  source = resolve(source);
  target = resolve(target);
  if (source === target) throw new Error("Source and destination must differ");
  mkdirSync(dirname(target), { recursive: true, mode: 0o700 });
  const temporary = mkdtempSync(join(dirname(target), ".pki-copy-"));
  let db: DatabaseSync | undefined;
  try {
    db = new DatabaseSync(source, { readOnly: true });
    const copy = join(temporary, "catalog.sqlite");
    db.prepare("VACUUM INTO ?").run(copy);
    const evidence = inspectCatalog(copy);
    chmodSync(copy, 0o600);
    linkSync(copy, target); // Exclusive creation: fail if target already exists.
    return evidence;
  } finally {
    db?.close();
    rmSync(temporary, { recursive: true, force: true });
  }
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const [action, source, target] = process.argv.slice(2);
  try {
    if (!["backup", "restore"].includes(action) || !source || !target)
      throw new Error(
        "Usage: maintenance.js backup|restore SOURCE NEW_DESTINATION",
      );
    console.log(JSON.stringify({ action, ...copyCatalog(source, target) }));
  } catch (error) {
    console.error(
      error instanceof Error ? error.message : "Catalog copy failed",
    );
    process.exitCode = 1;
  }
}
