# Engine parity report

`pnpm build:ocaml && pnpm parity:engines` runs the same cases against the
TypeScript and native OCaml engines. It writes `.context/parity-report.json`,
prints JSON paths for differences, and exits unsuccessfully if a comparison or
shared golden differs. The command requires the native OCaml artifact; a
missing build is a blocked run, not a skipped engine.
Set `FORMA_OCAML_CLI` to compare against a native CLI built at another path.

Use `pnpm parity:engines --case operational-effects` to narrow a run, or
`pnpm parity:engines --report /path/to/report.json` to save the report elsewhere.
`node scripts/parity-engines.mjs --list` shows cases and tracked gaps without
requiring a build. `pnpm parity:engines:test` checks the comparison rules.

`cases.json` selects parse, expansion, typecheck, evaluation, and effect IR
comparisons. The runner also executes every `../forma-zero` case and compares
both engines with each other and the existing shared golden. `matrix.json`
records intentional differences and missing surfaces.

The comparison retains AST and diagnostic source offsets and declaration
provenance. It drops line/column duplicates, generated value references,
artifact envelope metadata, and diagnostic prose. Map entries are sorted by
key because insertion order is not part of the map value contract. Type name
aliases are declared on individual fixtures; the operational-effects fixture
currently maps OCaml `Str` to canonical `String`. Add an explicit reason to
the matrix before allowing any other difference.

`test:all` and `release:check` run this comparison after building OCaml. A
change to one engine that affects a shared fixture should update the other
engine or document a deliberate difference in `matrix.json`.
