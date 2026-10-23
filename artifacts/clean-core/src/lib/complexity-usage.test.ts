import { test } from "node:test";
import assert from "node:assert/strict";
import { complexitySize, complexityLabel, itemComplexitySize } from "./complexity-size";
import { usageFor } from "./usage-status";

test("complexity size buckets", () => {
  assert.deepEqual([0, 5, 5.1, 10, 20, 30, 40, 40.5].map(complexitySize), ["XS", "XS", "S", "S", "M", "L", "XL", "XXL"]);
  assert.equal(complexitySize(-1), null);
  assert.equal(complexitySize(NaN), null);
  assert.equal(complexitySize(undefined), null);
  assert.equal(complexitySize("xl"), "XL");
  assert.equal(complexitySize("12"), null);
  assert.equal(complexityLabel(null), "Unassessed");
});

const meta = { collectionStart: "2025-01-01", collectionEnd: "2025-06-30", telemetryCoverage: 100, coverage: 100 };
test("usage semantics are conservative", () => {
  const item = { id: "1", objectName: "ZPROG" };
  assert.equal(usageFor(item, [{ type: "usage", rows: [{ objectName: "ZPROG", usageCount: 3 }], metadata: {} }]).status, "in-use");
  assert.equal(usageFor(item, [{ type: "usage", rows: [{ objectName: "ZPROG", usageCount: 0 }], metadata: meta }]).status, "not-in-use");
  assert.equal(usageFor(item, [{ type: "usage", rows: [{ objectName: "ZPROG", usageCount: 0 }], metadata: { ...meta, telemetryCoverage: undefined } }]).status, "unknown");
  assert.equal(usageFor(item, [{ type: "usage", rows: [{ objectName: "ZPROG", usageCount: 0 }], metadata: { ...meta, collectionEnd: undefined } }]).status, "unknown");
  assert.equal(usageFor(item, [{ type: "usage", rows: [], metadata: meta }]).status, "unknown");
  assert.equal(usageFor(item, []).status, "unknown");
  assert.equal(usageFor(item, [{ type: "usage", rows: [{ objectName: "ZPROG", usageCount: 0 }, { objectName: "ZPROG", usageCount: 0, metadata: { telemetryCoverage: 80 } }], metadata: meta }]).status, "unknown");
  assert.equal(usageFor(item, [{ type: "usage", rows: [{ objectName: "ZPROG", usageCount: 0, metadata: meta }], metadata: {} }]).status, "not-in-use");
  assert.equal(usageFor({ ...item, usageStatus: "unknown", usageCount: 0 }, []).count, null);
});

test("engine fields win", () => {
  assert.equal(itemComplexitySize({ complexitySize: null, complexity: 0 }), null);
  assert.equal(itemComplexitySize({ complexity: 0 }), "XS");
  assert.equal(usageFor({ objectName: "Z", usageStatus: "unknown" }, [{ type: "usage", rows: [{ objectName: "Z", usageCount: 0 }], metadata: meta }]).status, "unknown");
});
