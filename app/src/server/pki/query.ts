import { createHash } from "node:crypto";
import type { PkiQuery } from "../../shared/pki.js";
import { pkiSearchFields } from "../../shared/pki.js";
import { normalizeFingerprint, normalizeSerial } from "./certificate.js";
import { PkiError } from "./adapter.js";
export function validateQuery(raw: any): PkiQuery {
  if (
    !raw ||
    !Array.isArray(raw.sources) ||
    raw.sources.length > 100 ||
    raw.sources.some((s: unknown) => typeof s !== "string")
  )
    throw new PkiError(400, "Select up to 100 sources");
  if (!Array.isArray(raw.conditions) || raw.conditions.length > 12)
    throw new PkiError(400, "Up to 12 search conditions are supported");
  for (const c of raw.conditions) {
    if (
      !c ||
      typeof c.value !== "string" ||
      c.value.length > 1024 ||
      !Object.prototype.hasOwnProperty.call(pkiSearchFields, c.field) ||
      !pkiSearchFields[c.field]?.operators.includes(c.operator)
    )
      throw new PkiError(400, "Invalid search condition");
    try {
      if (c.field === "serial") normalizeSerial(c.value);
      if (c.field === "fingerprint") normalizeFingerprint(c.value);
    } catch {
      throw new PkiError(400, "Invalid certificate identifier");
    }
    if (
      c.field === "keySize" &&
      (!/^\d+$/.test(c.value) || Number(c.value) > 65536)
    )
      throw new PkiError(400, "Invalid key size");
    if (
      ["notBefore", "notAfter"].includes(c.field) &&
      !Number.isFinite(Date.parse(c.value))
    )
      throw new PkiError(400, "Invalid date");
  }
  for (const [field, values] of Object.entries({
    match: ["all", "any"],
    sort: ["cn", "serial", "sourcePath", "type", "notAfter", "revoked"],
    direction: ["asc", "desc"],
    type: ["", "server", "client", "both", "ca", "unknown"],
    validity: ["", "valid", "expiring", "expired", "not_yet_valid"],
    revocation: ["", "revoked", "not_revoked", "unknown"],
  })) {
    if (raw[field] !== undefined && !values.includes(raw[field]))
      throw new PkiError(400, "Invalid " + field);
  }
  const limit = raw.limit ?? 50;
  if (raw.offset !== undefined && (!Number.isSafeInteger(raw.offset) || raw.offset < 0))
    throw new PkiError(400, "Invalid page offset");
  if (raw.cursor && raw.offset)
    throw new PkiError(400, "Use either a cursor or a page offset");
  if (!Number.isInteger(limit) || limit < 1 || limit > 200)
    throw new PkiError(400, "Page size must be between 1 and 200");
  if (
    raw.cursor !== undefined &&
    (typeof raw.cursor !== "string" || raw.cursor.length > 4096)
  )
    throw new PkiError(400, "Invalid cursor");
  return {
    ...raw,
    match: raw.match ?? "all",
    sort: raw.sort ?? "notAfter",
    direction: raw.direction ?? "asc",
    limit,
  };
}
export function whereQuery(query: PkiQuery, now = Date.now()) {
  const params: (string | number)[] = [...query.sources];
  const clauses = [
    query.sources.length
      ? `c.sourceId IN (${query.sources.map(() => "?").join(",")})`
      : "0",
  ];
  if (query.type) {
    clauses.push("c.type=?");
    params.push(query.type);
  }
  if (query.revocation) {
    clauses.push("c.revoked=?");
    params.push(query.revocation);
  }
  if (query.validity === "expired") {
    clauses.push("c.notAfter<=?");
    params.push(now);
  }
  if (query.validity === "not_yet_valid") {
    clauses.push("c.notBefore>?");
    params.push(now);
  }
  if (query.validity === "valid" || query.validity === "expiring") {
    clauses.push("c.notBefore<=? AND c.notAfter>?");
    params.push(now, now);
    if (query.validity === "expiring") {
      clauses.push("c.notAfter<=?");
      params.push(now + 30 * 86400000);
    }
  }
  const conditions = query.conditions.map((c) => {
    if (c.field === "text") {
      const pattern = "%" + c.value.replace(/[\\%_]/g, "\\$&") + "%";
      const serial = c.value.replace(/[:\s-]/g, "").toLowerCase();
      params.push(pattern, pattern, /^[0-9a-f]+$/.test(serial) ? "%" + serial + "%" : pattern);
      return "(c.cn LIKE ? ESCAPE '\\' OR c.id IN (SELECT certificateId FROM sans WHERE value LIKE ? ESCAPE '\\') OR c.serial LIKE ? ESCAPE '\\')";
    }
    let value: string | number =
      c.field === "serial"
        ? normalizeSerial(c.value)
        : c.field === "fingerprint"
          ? normalizeFingerprint(c.value)
          : c.field === "keySize"
            ? Number(c.value)
            : ["notBefore", "notAfter"].includes(c.field)
              ? Date.parse(c.value)
              : c.value;
    // Hex identifiers are normalized before storage and search. Binary comparisons
    // use their indexes; NOCASE would force full scans of the binary indexes.
    if (["serial", "fingerprint"].includes(c.field)) {
      if (c.operator === "prefix") {
        params.push(value, String(value) + "g");
        return `(c.${c.field}>=? AND c.${c.field}<?)`;
      }
      params.push(value);
      return `c.${c.field}=?`;
    }
    const san = c.field.startsWith("san_");
    const column = san ? "s.value" : "c." + c.field;
    if (san) params.push(c.field.slice(4));
    let op = c.operator === "lt" ? "<" : c.operator === "gt" ? ">" : "=";
    if (c.operator === "contains" || c.operator === "prefix") {
      op = "LIKE";
      value = String(value).replace(/[\\%_]/g, "\\$&") + "%";
      if (c.operator === "contains") value = "%" + value;
    }
    params.push(value);
    const expression = `${column} ${op} ? COLLATE NOCASE${op === "LIKE" ? " ESCAPE '\\'" : ""}`;
    return san
      ? `c.id IN (SELECT s.certificateId FROM sans s WHERE s.type=? AND ${expression})`
      : expression;
  });
  if (conditions.length)
    clauses.push(
      "(" + conditions.join(query.match === "any" ? " OR " : " AND ") + ")",
    );
  return { sql: clauses.map((c) => "(" + c + ")").join(" AND "), params };
}
export function queryKey(q: PkiQuery) {
  const { cursor, offset, ...rest } = q;
  return createHash("sha256").update(JSON.stringify(rest)).digest("hex");
}
