# Surface goldens

`cases.json` lists the source fixtures and the surfaces checked for each one.
`goldens/<case-id>.json` stores the normalized TypeScript output for every
listed surface: 112 cases and 227 outputs (73 parse, 1 expand, 80 typecheck,
46 evaluate, 13 effect IR, 14 canonical IR). The 13 Forma Zero evaluation cases
keep their goldens in `../forma-zero/expected.json`, and the session load and
retained-value comparisons use the reviewed expectations in
`../session-load/loads.json`.

These expectations pin current pre-alpha behavior, including diagnostic codes
and author offsets. They do not imply support for untested features.

## Commands

```sh
pnpm surfaces            # build ts and host, then check TypeScript against the goldens
pnpm surfaces --update   # rewrite the goldens from TypeScript output
pnpm surfaces:test       # runner unit tests plus the check
```

`pnpm surfaces:test` is part of `pnpm test`, `pnpm test:js`, and ordinary
JavaScript CI. The check fails on any difference from a stored golden and
writes a detailed report to `.context/surfaces-report.json`. Fixture sources
are loaded with source IDs of the form `surfaces/<case-id>`.

`--update` always runs the complete suite. Object keys are sorted for readable,
deterministic diffs. Review the generated JSON before committing it: an update
records whatever TypeScript currently produces, so a changed golden must be
explained by the change under review.

## History

The goldens were captured from the native OCaml engine, most recently in #60
and the Int/Float changes in #70, #71, and #74. Until the OCaml engine was
removed, a runner compared TypeScript and both OCaml targets against them with
a reviewed divergence allowlist. When the goldens were regenerated from
TypeScript, the only changes were the 22 reviewed numeric vocabulary
differences in that allowlist: OCaml displayed `Float` as `Number`, used 63-bit
integers, and accepted `Number` and `Num` annotations. See
[Retiring the OCaml engine](../../docs/engine-consolidation.md).

## Normalization

The comparison keeps AST and diagnostic source offsets and declaration
provenance. `scripts/surfaces/compare.mjs` drops line/column duplicates,
generated value references, artifact envelope metadata, and diagnostic prose.
Map entries are sorted by key because insertion order is not part of the map
value contract. Numeric type names and value kinds are never collapsed: the
numeric cases retain Int/Float literal and value kinds, including integral
Float results, division, rounding, equality, quotation, and printing.

A case may include `expected`, keyed by pass, to pin selected normalized
results directly in `cases.json`. The row-operation fixtures use this for
successful types and values, diagnostic codes, and author source offsets.
