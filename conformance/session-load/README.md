# Session load and edit scenarios

Engine-neutral sources and expected results ported from
`packages/ocaml/scripts/artifact-cache.mjs` and `incremental.mjs`.
The OCaml scripts remain the reference. TypeScript tests exercise these
scenarios through the host and analysis workspace, comparing every edit with a
fresh session or analysis. They assert results rather than cache counters:
TypeScript has a module value cache and workspace query caches, but no equivalent
of OCaml's artifact declaration cache or per-form inference cache yet.

The scenarios cover private and public edits, removal of exports and schemas,
replacement and deletion of declarations, and restoration after invalid edits.

`loads.json` is compared by `pnpm parity:engines` (including TypeScript-only
mode): successful structural loads,
located surface errors, checked preludes, and unchanged values after a failed
prelude replacement. Diagnostic codes for HM errors remain engine-specific.
The direct TypeScript elaborator reports missing schema references with
`elaborate/hole-type`; OCaml's artifact path reports `elaborate/unknown-reference`.
Both are stored in the scenario expectations.

The module schema scenarios use core `type` declarations for the same exported
record shapes. TypeScript modules require descriptor libraries to be imported
explicitly, whereas OCaml's original scenarios use session-global ontology
forms. The separate elaboration scenarios retain the original `entity`/`seed`
syntax and exercise canonical artifacts directly.
