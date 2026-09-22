import { pkiSearchFields, type PkiQuery, type PkiSource } from "./pki.js";
export const pkiSelectionKey = "vaultlens.pki.sources";
// Browser preferences only: source IDs are always intersected with live authorization.
export function restorePkiQuery(
  params: URLSearchParams,
  sources: PkiSource[],
  saved: unknown,
): PkiQuery {
  let raw: any = {};
  try {
    raw = JSON.parse(params.get("filter") || "{}");
  } catch {
    throw new Error(
      "Invalid shared search. Clear the URL filter to start a new search.",
    );
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw))
    throw new Error("Invalid shared search");
  const mount = params.get("mount")?.replace(/\/$/, "");
  const selection =
    raw.sources ??
    (mount ? sources.filter((s) => s.path === mount).map((s) => s.id) : saved);
  const ids = Array.isArray(selection)
    ? selection.filter((id): id is string => typeof id === "string")
    : sources.map((s) => s.id);
  const q: PkiQuery = {
    sources: sources.filter((s) => ids.includes(s.id)).map((s) => s.id),
    conditions: [],
    match: "all",
    sort: "notAfter",
    direction: "asc",
    limit: 50,
  };
  if (Number.isInteger(raw.limit) && raw.limit >= 1 && raw.limit <= 200) q.limit = raw.limit;
  for (const [field, values] of Object.entries({
    match: ["all", "any"],
    sort: ["cn", "serial", "sourcePath", "type", "notAfter", "revoked"],
    direction: ["asc", "desc"],
    type: ["", "server", "client", "both", "ca", "unknown"],
    validity: ["", "valid", "expiring", "expired", "not_yet_valid"],
    revocation: ["", "revoked", "not_revoked", "unknown"],
  })) {
    if (raw[field] !== undefined) {
      if (!values.includes(raw[field]))
        throw new Error("Invalid shared search: " + field);
      Object.assign(q, { [field]: raw[field] });
    }
  }
  if (raw.conditions !== undefined) {
    if (
      !Array.isArray(raw.conditions) ||
      raw.conditions.length > 12 ||
      !raw.conditions.every(
        (c: any) =>
          c &&
          typeof c.value === "string" &&
          c.value.length <= 1024 &&
          Object.prototype.hasOwnProperty.call(pkiSearchFields, c.field) &&
          pkiSearchFields[c.field].operators.includes(c.operator),
      )
    )
      throw new Error("Invalid shared search conditions");
    q.conditions = raw.conditions.map(({ field, operator, value }: any) => ({
      field,
      operator,
      value,
    }));
  }
  return q;
}
