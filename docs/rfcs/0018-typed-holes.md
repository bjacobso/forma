# RFC 0018: Typed holes and goals

| | |
| --- | --- |
| Status | Proposed; not implemented |
| Created | 2026-10-25 |
| Scope | `?` and `?name` expression holes, inference that continues past them, goal reports with in-scope bindings and permitted effects, language services, repair diagnostics |
| Direction | A hole is an expression whose type the checker solves instead of rejecting; every hole reports what would fit there |

## Summary

An author, or a model, can leave part of an expression unwritten:

```lisp
(: line-total (-> {:unit-cents Int :qty Int} Int))
(define line-total [line]
  (* line.unit-cents ?qty))
```

The checker does not stop at `?qty`. It gives the hole a fresh type variable,
finishes inference, and reports a goal:

```text
3:22 hole ?qty : Int
  in line-total
  line : {:unit-cents Int :qty Int}
```

Inside an Effect body, the goal also lists the errors and requirements that
the enclosing signature still permits. A program with holes does not
evaluate, emit, or generate code. Each hole is a diagnostic with code
`typecheck/hole` and a structured goal in `details`.

## Motivation

A typed program with a gap in it is a question the checker can already
answer: which type belongs there, and which names in scope have it. Today the
only way to ask is to write a wrong expression and read the mismatch, or to
leave a name unbound, which fails the whole top-level form and discards
what inference learned about it.

Bend writes `?name` to print the current goal and `?TODO` to leave a hole
open. Agda, Idris, and Haskell's typed holes do the same. In each case the
goal is the main interaction between the author and the checker, not just an
error.

Forma already has the pieces a goal needs: bidirectional checking supplies the expected
type for signatures, lambda bodies, and application arguments. The mechanics
checker knows each operation's declared errors and requirements. The workbench
lists slots and capabilities. What is missing is an expression that asks.

Holes also serve the repair loop of
[RFC 0012](./0012-checked-evaluation.md). A model that receives
"`?qty : Int`, with `line : {:unit-cents Int :qty Int}` in scope" has a
smaller problem than one that receives a mismatch between two types it did
not write.

## Current state

- **No expression holes.** `CoreExpr` (`packages/ts/src/type/core-expr.ts`)
  has no hole node. Every "hole" in the engine is a descriptor slot hole
  ([Typed forms](../language.md#typed-forms), `elaborate/hole-type`), an
  Elm view hole (`Elm.ts`), or an editor slot placeholder (`editor/slots.ts`).
- **`?` is an ordinary symbol character.** `readSymbol`
  (`reader/lexer.ts`) accepts `?` anywhere in a symbol, so `(define ?q 3)`
  checks and `?q` is a binding. No source in `preludes/`, `examples/`,
  `conformance/`, or `docs/` uses a `?`-prefixed name.
- **Unbound names fail the form.** `inferVar` (`type/infer-core.ts`) reports
  `typecheck/unbound-symbol` through `ctx.fail`. With `onFormError`
  (`type/infer-program.ts`), the substitution is rolled back to before the
  form and its definitions are rebound to a fully polymorphic scheme. `_` in
  expression position is such an unbound name; it is special only in patterns.
- **Expected types are not recorded.** `checkExpr(env, expr, expected)`
  (`type/check-expr.ts`) is used for signatures, lambda bodies, application
  arguments, and descriptor children, but only synthesized types are recorded,
  in `NodeTypeMap` through `ctx.recordType`. Consumers reapply the final
  substitution (`lsp/hm-lsp.ts`, `modules/check.ts`).
- **No typed scope query.** Completion (`analysis/completion.ts`) lists
  visible locals from the symbol index, but their `detail` comes from the
  top-level `typeEnv`, so locals have no accurate type. No API lists the
  bindings in scope at an offset with their types. `collectNodes`
  (`lsp/hm-lsp.ts`) does not descend into `do!`, so nodes inside Effect bodies
  have no typed spans.
- **Effect permissions are checked after the fact.** In the HM checker,
  `inferEffectDo` synthesizes error and requirement sets and `assignType`
  compares them with the signature at the `do!` node. The mechanics checker's
  `checkOperation` passes only the success type into the body and compares
  sets in `checkEffectAgainst` (`mechanics/undeclared-error`,
  `mechanics/undeclared-requirement`). An unknown name there reports
  `mechanics/unbound-name` and continues with `unknown`.
- **Diagnostics.** `Diagnostic` (`diagnostic/diagnostic.ts`) has `code`,
  `severity` (`error`, `warning`, `info`), `message`, `phase`, `span`, and
  free-form `details`. `analyzeDocument` (`analysis/workspace.ts`) drops
  `details` from typecheck diagnostics.

## Proposal

### Syntax

`?` is an anonymous hole and `?name` is a named hole, in any expression
position:

```lisp
(map ? orders)
(if ?eligible "welcome" "skip")
```

Names follow symbol rules after the `?`. A named hole's name must be unique in
its module; a repeat reports `typecheck/duplicate-hole`. Two anonymous holes
are two goals.

A `?`-prefixed name in a binding position (`define`, `fn` parameters, `let`,
patterns, `do!` bindings) reports `syntax/hole-binding`. This is a breaking
change to names that are legal today; no tracked source uses them. Inside
`quote`, `?x` remains a symbol. A macro that produces `?x` in an expression
position produces a hole, so a macro can leave a goal for its user.

`?` does not change keywords (`:?x`) or names with `?` elsewhere (`even?`).

### Checking

Lowering produces a new `CoreExpr` node, `Hole { label?, id }`. In inference:

- In synthesis, a hole gets a fresh type variable and records nothing else.
- In `checkExpr`, a hole records the expected type it was checked against and
  returns it.
- Neither case fails. The rest of the form checks normally, and later
  constraints, such as another argument or the enclosing signature, solve the
  hole's variable.

After inference, the final substitution is applied to every hole's type. A
variable that is generalized into the owning definition's scheme is printed
with the scheme's variable name, so `(define f [x] ?)` reports `? : b` in
`f : (-> a b)`.

If the form fails for another reason, its holes are still reported, after the
other diagnostic and without `goal`, because the rollback discards their
solutions.

The mechanics checker treats a hole like `mechanics/unbound-name` does today:
it continues with the expected success type where one flows down, and
`unknown` otherwise. It reports `mechanics/hole` with the same goal shape.

### Goals

Each hole produces one diagnostic:

```ts
interface HoleGoal {
  readonly label?: string;                 // "qty" for ?qty
  readonly span: Span;
  readonly goal?: string;                  // source type syntax, e.g. "Int"
  readonly owner?: string;                 // enclosing top-level definition
  readonly bindings: readonly {
    readonly name: string;
    readonly type: string;
    readonly scope: "local" | "module" | "import";
    readonly fits?: boolean;               // stage 3
  }[];
  readonly permits?: {                     // inside an Effect body with a signature
    readonly errors: readonly string[];
    readonly requirements: readonly string[];
  };
}
```

The diagnostic has code `typecheck/hole` (or `mechanics/hole`), severity
`error`, phase `typecheck`, the hole's span, and `details: { hole: HoleGoal }`.
Its message is the first line of the rendering above. Severity is `error` so
that a program with holes never runs or emits.

- **Bindings.** The checker snapshots the environment when it reaches the
  hole. `bindings` lists names introduced inside the owning form first,
  innermost first, then module definitions and imports. Kernel builtins and
  prelude helpers are omitted. The list is capped (default 50) with
  `details.truncated`.
- **Types.** Goal and binding types are printed in source type syntax, the
  form an author writes in a signature, so a goal can be pasted into `(:`.
- **Permitted effects.** Inside an Effect body whose owner has a declared
  signature, `permits` is that signature's error and requirement sets. A hole
  in a `do!` binding position therefore reads as
  `?price : (Effect PricedCart [...] [...])` with the declared sets listed.
  `permits` is absent when the owner has no signature. The HM checker gets
  the sets from the owner's annotation, and the mechanics checker gets them
  from the operation signature that `checkOperation` already holds.
- **Form slots.** A hole inside an `(Expr T)` descriptor hole is checked
  against `T`, so a prelude slot reports its declared type as the goal.

### Language services

- `AnalysisWorkspace.analysis()` gains `holes: readonly HoleGoal[]`, and
  `analyzeDocument` keeps `details` for hole diagnostics.
- Hover on a hole shows the goal and bindings.
- Completion at a hole puts bindings whose type fits the goal first. `fits`
  is computed by trial unification against a copy of the final substitution.
- The language server reports holes with their code. The workbench renders a
  hole as a placeholder row with its goal, and a proposal can fill it with
  one structural edit.

### Repair

[RFC 0012](./0012-checked-evaluation.md)'s `renderDiagnostics` prints each
goal under its source line, with bindings indented. A rejected checked run
returns the goals in its diagnostics. [RFC 0019](./0019-specs-and-claims.md)
counts a claim whose definition contains a hole as open, not failed.

## Alternatives considered

- **`_` as the hole.** `_` in an expression is always unbound today, so
  reusing it breaks nothing. But `_` already means "ignore" in patterns and
  `(_ e)` is a catch-all `catch` pattern, so one token would mean "discard"
  in one position and "ask" in the next. `_` also has no room for a name.
  `?` matches Bend, Agda, and Idris, which models have seen.
- **A `(hole name)` form.** Unambiguous, but it reserves a common word and is
  heavier to type than the gap it marks.
- **Deferred holes.** Haskell can compile a program with holes and fail only
  when one is reached. That is useful for exploring, but it lets incomplete
  programs run. It could come later as an evaluation option (see decisions).
- **Better unbound-name errors instead.** Continuing past unbound names
  would improve recovery, but an unbound name is usually a typo. The author
  should have to say that a gap is deliberate.

## Implementation stages and validation

1. **Reader rules and HM holes.** `?` and `?name` lowering, the
   `syntax/hole-binding` and `typecheck/duplicate-hole` rules, the `Hole` node,
   recording expected types, goals, and bindings. New fixtures in
   `conformance/fixtures/typecheck/` with reviewed goals: a hole solved
   by an argument, by a signature, by a later use, a generalized hole, a hole in
   a form that fails for another reason, and a hole in a descriptor slot.
2. **Mechanics holes.** `mechanics/hole` with `permits`. An
   `conformance/effect-typescript` negative case with a hole in a `do!`
   binding whose goal lists the declared sets.
3. **Language services.** `holes` in analysis, hover, `fits` ranking in
   completion, language server mapping, typed spans inside `do!`, and the
   workbench placeholder. Workbench browser tests cover filling a hole.
4. **Repair rendering.** Goals in `renderDiagnostics`, pinned by golden
   tests with RFC 0012's rendering.

## Decisions still required

- Whether `?name` is reserved only in expressions or also rejected as a
  definition name in a module's exports, which today could be imported
  elsewhere.
- Whether evaluation should accept holes behind an option and fail with
  `eval/hole` when one is reached.
- Whether `fits` should also propose applications, such as a function whose
  result fits the goal, or only bindings.
- Whether goals should use source type syntax everywhere, which would change
  how `showType` prints hover types.

## Related designs

Bend's [guide](https://github.com/bendlang/bend/blob/main/guide/GUIDE.md)
uses `?name` to print the current goal and `?TODO` to leave a proof open.
Agda's interactive holes, Idris's `?name` holes, and GHC's typed holes report
a goal type and the relevant bindings in scope. GHC's
`-fdefer-typed-holes` turns holes into runtime errors.
