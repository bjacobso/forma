# @forma conformance suites

Shared, implementation-neutral fixtures exercised by **both** Forma engines:

- `@formalang/ts` — `packages/ts/test/forma-zero.test.ts` (vitest)
- `@formalang/ocaml` — `packages/ocaml/scripts/forma-zero.mjs` (daemon ABI;
  wired into `test:ocaml` and runnable alone via `pnpm --filter @formalang/ocaml forma-zero`)

A suite is a directory containing:

- `prelude.lisp` — definitions loaded once, written in the **shared dialect**;
- `cases/<name>.lisp` — one **single top-level expression** per file,
  evaluating to a **scalar** (string, int, or bool) so result comparison never
  depends on either engine's collection encoding;
- `expected.json` — `name → { kind: "string" | "int" | "bool", value }`.

`fixtures/` contains the larger reader, typechecker, and canonical-artifact
corpora used by the native implementation. The Markdown programs in
`../examples` and the language definitions in `../preludes` complete the
cross-target corpus.

## The shared dialect (discovered, not designed)

The TS engine is dynamic; the OCaml engine runs HM typechecking on every
`loadPrelude`/`evaluate`. The intersection that actually runs on both:

- forms: `define` / `fn` / `let` / `if` / `do` / `cond` / `when` / `not`,
  plus the collection builtins common to `Builtins.defaultBuiltins` and
  `eval_builtin*.ml`;
- **no self-recursion** — the OCaml evaluator's closures cannot see their own
  binding. Every derivation must be a fold (`reduce` / `map` / `filter` /
  `flat-map`), which is no accident: it is the kernel's own claim;
- **no variadic fns** — `& rest` params evaluate on both but are untypeable
  on the HM engine;
- **Vector vs List**: vector literals are `Vector`, but polymorphic collection
  parameters get pinned to `List`; `(concat [...literal...] [])` is the
  portable List constructor;
- **homogeneous collections only** — query variables are therefore plain
  strings declared in an explicit `vars` list, not tagged values, and
  unification failure is the empty collection (0-or-1-env results), not a
  sentinel;
- maps with statically-known keyword keys are records on the HM engine; an
  `assoc` with a runtime string key produces the dynamic map type (see
  `empty-env`);
- avoid symbols like `e1`/`e2` — the OCaml reader lexes them as malformed
  number literals.

The OCaml runner loads the prelude **one top-level form per `loadPrelude`
request** (REPL-style): the engine generalizes a define's type when storing it
to the session, but typechecks a multi-form program monomorphically, and the
prelude relies on let-polymorphism between defines (`member?` is used at
several item types).

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

If a case passes on one engine and fails on the other, that is a **language
parity bug**, not a kernel bug. If a behavior cannot be expressed here without
a new builtin, that is the Roots-of-Lisp failure the suite exists to catch —
see the operational-effects section of the [language guide](../docs/language.md).
