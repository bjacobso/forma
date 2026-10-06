import assert from "node:assert/strict";
import { emitExampleModules, exampleModules } from "./corpus-emission.mjs";
const sources = [...exampleModules().values()].flat();
assert.ok(sources.length > 0, "Corpus must contain sources");
const results = await emitExampleModules();
assert.deepEqual(results.map(r=>r.sourceId).sort(), sources.map(s=>s.sourceId).sort());
let declarations = 0;
for (const result of results) {
  assert.equal(result.ok, true, JSON.stringify(result));
  const content = result.artifact.content;
  assert.equal(content.hashAlgorithm, "md5");
  assert.equal(typeof content.sourceHashes[result.sourceId], "string");
  assert.equal(typeof content.preludeHashes["preludes/ontology.lisp"], "string");
  assert.equal(typeof content.declarationsHash, "string");
  assert.equal(content.declarationCount, content.declarations.length);
  assert.equal(content.declarationProvenance.length, content.declarationCount);
  assert.equal(content.declarationTypeSummaries.length, content.declarationCount);
  assert.equal(content.typeSummary.declarationCount, content.declarationCount);
  assert.equal(content.derivedArtifacts[0].declarations.length, content.declarationCount);
  for (const summary of [...content.declarationTypeSummaries, ...content.derivedArtifacts[0].declarations]) {
    assert.equal(typeof summary.resultType, "string");
    assert.notEqual(summary.kind, "Unknown");
  }
  for (const [index, provenance] of content.declarationProvenance.entries()) {
    assert.equal(provenance.declarationIndex, index);
    assert.equal(provenance.sourceId, result.sourceId);
    assert.equal(typeof provenance.formIndex, "number");
    for (const key of ["startOffset", "endOffset", "startLine", "startColumn", "endLine", "endColumn"]) assert.equal(typeof provenance.span[key], "number");
    assert.ok(provenance.span.endOffset > provenance.span.startOffset);
  }
  declarations += content.declarationCount;
}
console.log(`forma-ocaml corpus integrity ok (${results.length} sources, ${declarations} declarations)`);
