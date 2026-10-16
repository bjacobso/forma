import assert from "node:assert/strict";
import { test } from "node:test";
import {
  diffValues,
  normalizeAst,
  normalizeTsDeclarations,
  normalizeTypecheck,
  normalizeValue,
} from "./compare.mjs";

test("parse comparison keeps offsets while dropping line and column metadata", () => {
  assert.deepEqual(normalizeAst({
    ast: [{ kind: "int", value: 1, span: { sourceId: "a", startOffset: 2, endOffset: 3, startLine: 1 } }],
    diagnostics: [],
  }), {
    ast: [{ kind: "int", value: 1, span: { sourceId: "a", startOffset: 2, endOffset: 3 } }],
    diagnostics: [],
  });
});

test("map comparison ignores insertion order but keeps key and value differences", () => {
  const left = { kind: "map", entries: [
    { key: { kind: "string", value: "b" }, value: { kind: "int", value: 2 } },
    { key: { kind: "string", value: "a" }, value: { kind: "int", value: 1 } },
  ] };
  const right = { kind: "map", entries: left.entries.toReversed() };
  assert.deepEqual(normalizeValue(left), normalizeValue(right));
  const changed = structuredClone(right);
  changed.entries[0].value.value = 9;
  assert.equal(diffValues(normalizeValue(left), normalizeValue(changed))[0].path, "/entries/0/value/value");
});

test("artifact comparison strips summaries and keeps declaration provenance", () => {
  const payload = { kind: "EffectDef", name: "log", body: { kind: "Succeed", $summary: { resultType: "Effect" }, span: { sourceId: "test", startOffset: 5, endOffset: 9, startLine: 1 } } };
  const normalized = normalizeTsDeclarations([{
    sourceId: "test", formIndex: 2,
    span: { sourceId: "test", startOffset: 0, endOffset: 10, startLine: 1 }, payload,
  }]);
  assert.deepEqual(normalized, [{
    sourceId: "test", formIndex: 2,
    span: { sourceId: "test", startOffset: 0, endOffset: 10 },
    payload: { kind: "EffectDef", name: "log", body: { kind: "Succeed", span: { sourceId: "test", startOffset: 5, endOffset: 9 } } },
  }]);
  const changed = structuredClone(normalized);
  changed[0].formIndex = 3;
  assert.deepEqual(diffValues(normalized, changed).map((item) => item.path), ["/0/formIndex"]);
});

test("diff reports exact JSON pointer paths and missing fields", () => {
  assert.deepEqual(diffValues({ body: { kind: "Catch" } }, { body: { kind: "Pure", error: "oops" } }).map((item) => item.path), [
    "/body/error",
    "/body/kind",
  ]);
});

test("numeric type names and value kinds are never collapsed", () => {
  for (const type of ["Int", "Float"]) assert.equal(normalizeTypecheck({ display: type, diagnostics: [] }).type, type);
  assert.equal(diffValues(normalizeValue({kind: "int", value: 2}), normalizeValue({kind: "float", value: 2}))[0].path, "/kind");
});
