---
"@forma-language/forma": minor
---

Add an exported offline diagnostic catalog with stable identifiers, summaries,
explanations and consumer registration. Add typed diagnostic detail contracts
for consumer form/name/type checks, preserving enum and type alternatives and
exact unknown-type spans. Keep existing codes and embedding signatures.

Diagnostics gain optional author help and atomic source-span text edits.
Form `:check` results can supply details, help and fixes, which survive
elaboration and editor/host projections. The source-built CLI gains
`forma explain <code>`; unknown codes fail with `abi/unknown-code`.

See the consumer upgrade note for changes since `1317204`, including list-only
`concat`, exhaustive-match errors, larger diagnostic sets, hook-failure codes,
prelude extensions and offline package discovery. FX1 itself is additive.
