import assert from "node:assert/strict";
import { test } from "node:test";
import {
  canonicalType,
  diffValues,
  normalizeAst,
  normalizeOcamlDeclarations,
  normalizeTsDeclarations,
  normalizeValue,
} from "./compare.mjs";

test("type aliases are explicit and do not hide other type differences", () => {
  assert.equal(canonicalType("Str -> Effect<Str>", { Str: "String" }), "String -> Effect<String>");
  assert.equal(canonicalType("String -> Int", { Str: "String" }), "String -> Int");
  assert.equal(canonicalType("CustomStr -> Int", { Str: "String" }), "CustomStr -> Int");
});

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

test("artifact comparison strips envelopes and keeps declaration provenance", () => {
  const payload = { kind: "EffectDef", name: "log", body: { kind: "Succeed", span: { sourceId: "test", startOffset: 5, endOffset: 9 } } };
  const ts = normalizeTsDeclarations([{
    sourceId: "test", formIndex: 2,
    span: { sourceId: "test", startOffset: 0, endOffset: 10 }, payload,
  }]);
  const ocaml = normalizeOcamlDeclarations({
    declarations: [{ ...payload, $summary: { resultType: "EffectDef" } }],
    declarationProvenance: [{ sourceId: "test", formIndex: 2, span: { startOffset: 0, endOffset: 10, startLine: 1 } }],
    irVersion: "1",
  });
  assert.deepEqual(ts, ocaml);
  const changed = structuredClone(ocaml);
  changed[0].formIndex = 3;
  assert.deepEqual(diffValues(ts, changed).map((item) => item.path), ["/0/formIndex"]);
});

test("diff reports exact JSON pointer paths and missing fields", () => {
  assert.deepEqual(diffValues({ body: { kind: "Catch" } }, { body: { kind: "Pure", error: "oops" } }).map((item) => item.path), [
    "/body/error",
    "/body/kind",
  ]);
});

test("numeric type names and value kinds are never collapsed", () => {
  for (const type of ["Int", "Float", "Number"]) assert.equal(canonicalType(type, {}), type);
  assert.equal(diffValues(normalizeValue({kind: "int", value: 2}), normalizeValue({kind: "float", value: 2}))[0].path, "/kind");
});
