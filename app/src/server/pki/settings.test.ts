import { test } from "node:test";
import assert from "node:assert/strict";
import { collectionSettings } from "./settings.js";
test("collection limits reject invalid deployment settings", () => {
  assert.deepEqual(collectionSettings({}), {
    concurrency: 4,
    requestsPerSecond: 20,
  });
  assert.deepEqual(
    collectionSettings({
      VAULTLENS_PKI_CONCURRENCY: "16",
      VAULTLENS_PKI_REQUESTS_PER_SECOND: "100",
    }),
    { concurrency: 16, requestsPerSecond: 100 },
  );
  for (const value of ["", "0", "-1", "1.5", "NaN", "Infinity", "17"])
    assert.throws(() =>
      collectionSettings({ VAULTLENS_PKI_CONCURRENCY: value }),
    );
  assert.throws(() =>
    collectionSettings({ VAULTLENS_PKI_REQUESTS_PER_SECOND: "101" }),
  );
});
