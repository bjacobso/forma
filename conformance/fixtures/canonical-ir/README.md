# Canonical IR golden

`expected.json` is the canonical IR result for `schema.lisp` and `data.lisp`,
captured from the retired native OCaml engine. The capture loaded the `kernel`,
`compiler`, and `ontology` preludes, loaded both sources into one session, and
emitted `canonical-ir`. It retains artifact names, media types, and complete
content, including module identities, hashes, declarations, and author
provenance; it omits the outer artifact envelope. The current fixture has five
declarations, including two module-scoped records.

`packages/ts/test/artifacts.test.ts` emits the same sources from TypeScript and
compares declarations, declaration type summaries, provenance, module
identities (without source hashes), and the type summary with this file. The
OCaml envelope metadata and MD5 hashes are not compared. The website pipeline in
`apps/website/src/pipelines/canonicalIr.ts` imports the file as its stored
example.

Its original producer was removed with the OCaml engine. To change the
expectation, regenerate the compared content from TypeScript and review the
JSON diff.
