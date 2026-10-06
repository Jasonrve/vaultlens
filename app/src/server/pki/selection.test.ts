import { test } from "node:test";
import assert from "node:assert/strict";
import { restorePkiQuery } from "../../shared/pkiSelection.js";
import type { PkiSource } from "../../shared/pki.js";
import { whereQuery, validateQuery } from "./query.js";
test("shared searches whitelist controls, intersect authorization and preserve empty browser selection", () => {
  const sources = [{ id: "allowed", path: "pki" }] as PkiSource[];
  const restore = (raw: unknown, saved: unknown = ["allowed"]) =>
    restorePkiQuery(
      new URLSearchParams({ filter: JSON.stringify(raw) }),
      sources,
      saved,
    );
  assert.deepEqual(
    restore({ sources: ["forbidden", "allowed"], cursor: "old", limit: 200 })
      .sources,
    ["allowed"],
  );
  assert.deepEqual(restore({}, []).sources, []);
  assert.equal(restore({ limit: 200 }).limit, 200);
  assert.equal(restore({ limit: 201 }).limit, 50);
  assert.equal(restore({ offset: 100 }).offset, undefined);
  assert.equal(restore({ cursor: "old" }).cursor, undefined);
  for (const raw of [
    { match: "invalid" },
    { sort: "id" },
    { validity: "forever" },
    { conditions: [{ field: "__proto__", operator: "equals", value: "x" }] },
    {
      conditions: Array(13).fill({
        field: "cn",
        operator: "equals",
        value: "x",
      }),
    },
  ])
    assert.throws(() => restore(raw));
  assert.throws(() =>
    restorePkiQuery(new URLSearchParams("filter=%7B"), sources, null),
  );
  const q = validateQuery({
    sources: ["allowed"],
    conditions: [],
    type: "client",
    validity: "expired",
    revocation: "unknown",
  });
  const result = whereQuery(q, 1000);
  assert.deepEqual(result.params, ["allowed", "client", "unknown", 1000]);
  assert.match(result.sql, /notAfter<=/);
  const valid = whereQuery({ ...q, validity: "valid" }, 1000);
  assert.deepEqual(valid.params, ["allowed", "client", "unknown", 1000, 1000]);
  assert.match(valid.sql, /notBefore<=.*notAfter>/);
  for (const field of ["san_dns", "san_ip", "san_uri", "san_email"])
    assert.match(
      whereQuery(
        validateQuery({
          sources: ["allowed"],
          conditions: [{ field, operator: "prefix", value: "test" }],
        }),
      ).sql,
      /IN \(SELECT/,
    );
});
