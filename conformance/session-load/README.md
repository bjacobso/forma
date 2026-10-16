# Session load and edit scenarios

Engine-neutral sources and expected results, first ported from the retired
OCaml engine's artifact-cache and incremental-edit gate scripts and now
maintained as reviewed TypeScript expectations. `scenarios.json` is exercised
by `packages/ts/test/session-edits.test.ts` and
`packages/host/test/session-edits.test.ts` through the host and analysis
workspace, comparing every edit with a fresh session or analysis. They assert
results rather than cache counters: TypeScript has a module value cache and
workspace query caches, but no artifact declaration cache or per-form inference
cache yet.

The scenarios cover private and public edits, removal of exports and schemas,
replacement and deletion of declarations, and restoration after invalid edits.

`loads.json` is checked by `pnpm surfaces`: successful structural loads,
located surface errors, checked preludes, and unchanged values after a failed
prelude replacement due to typing or a descriptor payload metacheck. It pins
whether a load succeeded and whether its diagnostics are located, not HM
diagnostic codes.
The direct TypeScript elaborator reports missing schema references with
`elaborate/hole-type`; the OCaml artifact path reported
`elaborate/unknown-reference`.

The module schema scenarios use core `type` declarations for the same exported
record shapes. TypeScript modules require descriptor libraries to be imported
explicitly, whereas the original OCaml scenarios used session-global ontology
forms. The separate elaboration scenarios retain the original `entity`/`seed`
syntax and exercise canonical artifacts directly.
