import { test } from "node:test";
import assert from "node:assert/strict";
import { compareSerials } from "./comparison.js";

test("equal totals still detect new and local-only serials", () => {
  assert.deepEqual(compareSerials(["aa", "bb"], ["bb", "cc"]), {
    localCount: 2, vaultCount: 2, notCollected: 1, localOnly: 1,
  });
});
test("comparison normalizes separators, case, padding and duplicates", () => {
  assert.deepEqual(compareSerials(["ab", "cd"], ["00:AB", "00-ab", "CD"]), {
    localCount: 2, vaultCount: 2, notCollected: 0, localOnly: 0,
  });
});
test("empty lists retain history and invalid lists cannot become zero", () => {
  assert.deepEqual(compareSerials(["aa"], []), {
    localCount: 1, vaultCount: 0, notCollected: 0, localOnly: 1,
  });
  assert.deepEqual(compareSerials([], ["bb"]), {
    localCount: 0, vaultCount: 1, notCollected: 1, localOnly: 0,
  });
  assert.throws(() => compareSerials([], ["not-a-serial"]));
});
