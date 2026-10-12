import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {createHash} from "node:crypto";
import {test} from "node:test";
import {readNativeReferenceFileSync, remapNativeReferenceSpans} from "../../conformance/ocaml-reference/read.mjs";

const root = new URL("../../", import.meta.url);
const manifest = JSON.parse(readFileSync(new URL("conformance/ocaml-reference/numeric-vocabulary.json", root), "utf8"));

test("frozen native input edits recover the reviewed original source exactly", () => {
  for (const [file, entry] of Object.entries(manifest.files)) {
    const source = readNativeReferenceFileSync(new URL(file, root), "utf8");
    assert.equal(createHash("sha256").update(source).digest("hex"), entry.legacyHash, file);
  }
});

test("reference locations follow authored edits without normalizing numeric names or kinds", () => {
  const sourceId = "fixture";
  const output = {ast: [
    {kind: "symbol", value: "Number", span: {sourceId, startOffset: 5, endOffset: 11}},
    {kind: "float", value: 2, span: {sourceId, startOffset: 13, endOffset: 16}},
    {kind: "symbol", value: "Num", span: {sourceId, startOffset: 17, endOffset: 20}},
    {kind: "int", value: 2, span: {sourceId: "other", startOffset: 21, endOffset: 22}},
  ]};
  const mapped = remapNativeReferenceSpans(output, sourceId, [{start: 5, before: "Number", after: "Float"}, {start: 16, before: "Num", after: "Float"}]);
  assert.deepEqual(mapped.ast.map(item => item.span), [
    {sourceId, startOffset: 5, endOffset: 10},
    {sourceId, startOffset: 12, endOffset: 15},
    {sourceId, startOffset: 16, endOffset: 21},
    {sourceId: "other", startOffset: 21, endOffset: 22},
  ]);
  assert.deepEqual(mapped.ast.map(({kind, value}) => ({kind, value})), output.ast.map(({kind, value}) => ({kind, value})));
});
