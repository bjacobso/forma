import assert from "node:assert/strict";
import { test } from "node:test";
import { stableJson, validateGolden } from "./goldens.mjs";

test("stable goldens sort objects and preserve arrays and offsets", () => {
  assert.equal(stableJson({ b: 2, a: { y: 1, x: 0 } }), stableJson({ a: { x: 0, y: 1 }, b: 2 }));
  assert.notEqual(stableJson([1, 2]), stableJson([2, 1]));
  assert.notEqual(stableJson({ span: { startOffset: 1 } }), stableJson({ span: { startOffset: 2 } }));
});

test("golden coverage rejects missing surfaces and wrong cases", () => {
  const golden = { version: 1, id: "a", outputs: { parse: {} } };
  validateGolden(golden, "a", ["parse"]);
  assert.throws(() => validateGolden(golden, "b", ["parse"]), /coverage/);
  assert.throws(() => validateGolden(golden, "a", ["parse", "evaluate"]), /coverage/);
  assert.throws(() => validateGolden({ ...golden, version: 2 }, "a", ["parse"]), /coverage/);
});
