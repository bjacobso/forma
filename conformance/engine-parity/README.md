# Engine parity goldens

`goldens/<case-id>.json` stores native OCaml's normalized output for every
surface in `cases.json`: 100 cases and 195 outputs (62 parse, 1 expand,
70 typecheck, 35 evaluate, 13 effect IR, 14 canonical IR). The 13 Forma Zero
evaluation cases retain their existing goldens in `../forma-zero/expected.json`.
These expectations preserve the current pre-alpha behavior, including diagnostic
codes and author offsets; they do not imply parity for untested features.

Six session load and retained-value comparisons use the reviewed expectations
in `../session-load/loads.json`. They run in TypeScript-only mode and against
both OCaml targets in live mode.

`pnpm parity:engines --typescript-only` compares TypeScript with these references
without loading or requiring any OCaml artifact. `pnpm parity:engines:test` runs
both the runner's unit tests and this stored-output check, and is included in
`pnpm test`, `pnpm test:js`, and ordinary JavaScript CI.

`opam exec -- pnpm build:ocaml && pnpm parity:engines` keeps the live check:
TypeScript is checked against the goldens and reviewed divergences, native OCaml
against the goldens, and JavaScript OCaml against native OCaml for every output,
including session-based IR and Forma Zero. Native and JavaScript artifacts are
required; a missing build fails the run. Set `FORMA_OCAML_CLI` to select another
native CLI. The JS target uses `dist/js/jsoo_entry.cjs`; its exported ABI callback
runs in a worker for session coverage, without changing the prototype JS host's
public capabilities. The OCaml CI gate also runs this live check.

To regenerate while OCaml is still available:

```sh
mise run forma:ocaml:setup
opam exec -- pnpm build:ocaml
pnpm parity:engines --update-goldens
```

`FORMA_UPDATE_GOLDEN=1 pnpm parity:engines` is equivalent. Capture always runs
the complete suite and writes only native outputs, after all checks pass.
JavaScript target disagreement, runner errors, or unreviewed TypeScript differences
prevent writes. Object keys are sorted for readable, deterministic diffs. Review
the generated JSON before committing it; capture never updates the divergence
allowlist. Once OCaml is removed, these native expectations cannot be regenerated
from TypeScript.

`divergences.json` is an explicit per-case/per-surface allowlist. Each entry must
name a documented `gap` or `intentional-difference` in `matrix.json`, explain why,
and include the complete `differences` array from the report (JSON pointer path,
TypeScript value, OCaml value). The run fails on new, changed, or resolved
differences, and on duplicate or stale entries. Review the report and edit this
file deliberately before recapturing a changed reference.

The current allowlist is empty: TypeScript matches the references for all 214
selected outputs.
The historical `parse-nil` gap is resolved for the selected fixtures, and the two
selected operational-effects typecheck cases agree. Other Effect programs are
checked by the mechanics checker; HM typecheck parity for those programs is not
claimed. Remaining matrix rows describe capability and ABI differences outside
the captured surfaces, including artifact envelopes and
editor APIs; they are not blanket exceptions for case output differences.

An entry may include `expected`, keyed by pass, to pin a normalized golden
for each engine independently. The row-operation fixtures use this to pin
successful types and values, and diagnostic codes and author source offsets;
agreement between two engines alone does not establish correctness.

The comparison retains AST and diagnostic source offsets and declaration
provenance. It drops line/column duplicates, generated value references,
artifact envelope metadata, and diagnostic prose using `scripts/parity/compare.mjs`.
Map entries are sorted by key because insertion order is not part of the map
value contract. Type name aliases are declared on individual fixtures; the
operational-effects fixtures map OCaml `Str` to canonical `String`. No additional
span stripping or compiler semantic changes are part of capture.

Use `pnpm parity:engines --case operational-effects` to narrow a check, or
`pnpm parity:engines --report .context/custom-report.json` to save its detailed
report (default: `.context/parity-report.json`). The same filters work with
`--typescript-only`. `node scripts/parity-engines.mjs --list` lists fixtures and
matrix gaps without requiring an engine build. `test:all` and `release:check`
continue to include live comparison while OCaml exists.
