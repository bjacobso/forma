import assert from "node:assert/strict";
import { test } from "node:test";
import { diffValues } from "./compare.mjs";
import { checkDivergence, stableJson, validateDivergences } from "./goldens.mjs";

test("reviewed divergences reject new, changed, and resolved differences", () => {
  const differences = diffValues({ value: 1 }, { value: 2 });
  const divergence = { differences };
  assert.equal(checkDivergence(differences, divergence), true);
  assert.equal(checkDivergence(differences, undefined), false);
  assert.equal(checkDivergence(diffValues({ value: 3 }, { value: 2 }), divergence), false);
  assert.equal(checkDivergence([...differences, ...diffValues({ extra: 1 }, {})], divergence), false);
  assert.equal(checkDivergence([], divergence), false);
  assert.equal(checkDivergence([], undefined), true);
});

test("divergences must refer to existing cases and documented gaps", () => {
  const entry = { id: "a", pass: "parse", surface: "nil", reason: "Distinct AST node", differences: [{}] };
  const matrix = { surfaces: [{ id: "nil", status: "gap" }] };
  const validate = cases => validateDivergences({ version: 1, cases }, ["a/parse"], matrix);
  validate([entry]);
  assert.throws(() => validate([entry, entry]), /duplicate/);
  assert.throws(() => validate([{ ...entry, id: "removed" }]), /stale/);
  assert.throws(() => validate([{ ...entry, surface: "unknown" }]), /Invalid/);
  assert.throws(() => validate([{ ...entry, reason: "" }]), /Invalid/);
});

test("stable goldens sort objects and preserve arrays and offsets", () => {
  assert.equal(stableJson({ b: 2, a: { y: 1, x: 0 } }), stableJson({ a: { x: 0, y: 1 }, b: 2 }));
  assert.notEqual(stableJson([1, 2]), stableJson([2, 1]));
  assert.notEqual(stableJson({ span: { startOffset: 1 } }), stableJson({ span: { startOffset: 2 } }));
});

test("golden coverage rejects missing surfaces, wrong cases, and foreign references", async () => {
  const { validateGolden } = await import("./goldens.mjs");
  const golden = { version: 1, capturedFrom: "ocaml-native", id: "a", outputs: { parse: {} } };
  validateGolden(golden, "a", ["parse"]);
  assert.throws(() => validateGolden(golden, "b", ["parse"]), /coverage/);
  assert.throws(() => validateGolden(golden, "a", ["parse", "evaluate"]), /coverage/);
  assert.throws(() => validateGolden({ ...golden, capturedFrom: "typescript" }, "a", ["parse"]), /coverage/);
});
