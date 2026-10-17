# @forma conformance suites

Implementation-neutral fixtures that pin the behavior of Forma's TypeScript
engine (`@formalang/ts`, hosted by `@formalang/host`). Forma previously had a
second, OCaml engine; many stored expectations here were first captured from
it and are now maintained as reviewed TypeScript expectations. See
[Retiring the OCaml engine](../docs/engine-consolidation.md).

`forma-zero/` is the smallest of these suites. It runs in
`packages/ts/test/forma-zero.test.ts` (vitest) and in `pnpm surfaces`. The
directory contains:

- `prelude.lisp` — definitions loaded before each case;
- `cases/<name>.lisp` — one **single top-level expression** per file,
  evaluating to a **scalar** (string, int, or bool) so result comparison never
  depends on a collection encoding;
- `expected.json` — `name → { kind: "string" | "int" | "bool", value }`.

`effect-typescript/` is a TypeScript-target suite. It elaborates Effect
programs written in Forma, compares the generated Effect 4 modules with
goldens, typechecks them strictly, runs them, and checks the located
diagnostics for programs Forma must reject. See its README for how to add a
case.

`fixtures/` contains the larger reader, typechecker, and canonical-artifact
corpora. The Markdown programs in `../examples` and the language definitions in
`../preludes` complete the corpus.

[`surfaces/`](surfaces/README.md) stores normalized parse, expand, typecheck,
evaluate, and IR outputs for selected cases; `pnpm surfaces` checks TypeScript
against them. Other stored references live in [`modules/`](modules/README.md),
[`compile-time-modules/`](compile-time-modules/README.md),
[`fixtures/canonical-ir/`](fixtures/canonical-ir/README.md), and
[`artifacts/`](artifacts/README.md), including the example corpus counts in
`artifacts/corpus-golden.json`. Their READMEs document which
TypeScript tests check them and how they are updated. These expectations pin
current behavior for the selected fixtures; they do not extend the language.

`row-operations/` pins closed-record `Pick`, `Omit`, disjoint `Merge`, and
tagged payload collisions. Its explicit expectations live in
`surfaces/cases.json`, with goldens under `surfaces/goldens/row-operations/`.
The TypeScript tests and `pnpm surfaces` check these cases, including author
offsets for negative cases.

[`einvoice/`](einvoice/README.md) tests a local EN 16931 invoice fit spike with
Int-cent seed records, S/Z VAT and total checks, and author-located diagnostic
goldens. It is not a Peppol validator or the proposed benchmark harness.

## Dialect of the forma-zero fixtures

The prelude and cases were written in the intersection of what the dynamic
TypeScript evaluator and the retired OCaml engine (which ran HM typechecking on
every load) both accepted. They keep that style, although several of the
constraints below came from the OCaml engine rather than from TypeScript:

- forms: `define` / `fn` / `let` / `if` / `do` / `cond` / `when` / `not`,
  plus collection builtins from `Builtins.defaultBuiltins`;
- **no self-recursion** — every derivation is a fold (`reduce` / `map` /
  `filter` / `flat-map`), which is no accident: it is the kernel's own claim.
  (The OCaml evaluator's closures could not see their own binding.);
- **no variadic fns** — `& rest` params were untypeable on the HM engine;
- **Vector vs List**: `(concat [...literal...] [])` is used as the List
  constructor, because the HM engine pinned polymorphic collection parameters
  to `List`;
- **homogeneous collections only** — query variables are therefore plain
  strings declared in an explicit `vars` list, not tagged values, and
  unification failure is the empty collection (0-or-1-env results), not a
  sentinel;
- maps with statically-known keyword keys were records on the HM engine; an
  `assoc` with a runtime string key produces the dynamic map type (see
  `empty-env`);
- symbols like `e1`/`e2` are avoided because the OCaml reader lexed them as
  malformed number literals.

The TypeScript runners evaluate the prelude and each case as one program with
the default builtins.

## forma-zero

Executes the smallest portable operational kernel — unification →
`where`/`without` → the derived primitives → `opeval`, the admission loop —
and checks its behavior layer by layer:
unification, conjunctive query, negation-as-absence, constraints-as-folds,
grants-as-facts, admission/refusal, action execution, reconciler termination,
and the workflow step graph stored as facts and queried by the engine
executing it.

`opeval` is a fold over a bounded round counter rather than a recursion to
fixpoint (admission is idempotent, so extra rounds are no-ops); a real
substrate iterates to fixpoint.

A case that fails after an engine change is a **language regression**, not a
kernel bug. If a behavior cannot be expressed here without a new builtin, that
is the Roots-of-Lisp failure the suite exists to catch — see the
operational-effects section of the [language guide](../docs/language.md).
