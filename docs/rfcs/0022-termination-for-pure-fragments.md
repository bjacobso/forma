# RFC 0022: Termination checks for pure fragments

| | |
| --- | --- |
| Status | Proposed; not implemented |
| Created | 2026-10-25 |
| Scope | An opt-in check that pure code reachable from prelude-designated roots halts: acyclic references first, structural recursion later; diagnostics, interface and artifact records |
| Direction | Where a prelude promises that rules, views, or updates are pure, the checker can also promise that they finish, so step limits bound cost instead of catching loops |

## Summary

A prelude can ask the checker to prove that the functions it lowers, and
everything they reference, terminate. In the first stage the rule is simple:
the reference graph from those roots must be acyclic, no value of type
`Unknown` may be applied, and no recursive type may be reached.

```lisp
(define days-left [contact]
  (if (> contact.trial-days 0) (days-left contact) 0))
```

```text
rules.forma:2:33 termination/cycle
  rule trial-ending may not terminate: days-left refers to itself
```

A later stage accepts structural recursion: a function may call itself when
one argument is always a part taken from the same parameter by `match` or
destructuring. Interfaces and artifacts record which functions were checked.
Step limits stay; a terminating program can still be slow.

## Motivation

The email and Elm-style preludes make strong promises about the code an
author writes in them. Rules "are pure" and cannot call the mail provider.
Updates are exhaustive and views are pure. A host evaluating a rule set for
every contact, or a view on every message, also needs to know that each call
returns. Today it learns that a rule loops when the evaluation hits its step
limit, at run time, for the contact that triggers it.

The [Elm prototype](../elm.md) says it "does not prove totality". Its
[reference](../elm/reference.md) lists divergent functions among what the
checks do not rule out.

Bend requires every live recursive definition to terminate, by a syntactic
rule: recursive calls must pass a part obtained by pattern matching, and
mutual recursion is not allowed. The rule is restrictive but checkable in
milliseconds, and it covers the programs Bend expects.

Forma's pure fragments are smaller than Bend's language. Email and Elm
programs cannot declare recursive data, and the iteration builtins walk finite
collections. Most rules and views never recurse at all, so a check that only
forbids recursion would accept nearly every program written in them today.

## Current state

- **Recursion is unrestricted.** Top-level `define` may be recursive, and
  consecutive `define`s form a mutually recursive group
  (`packages/ts/src/type/infer-binding.ts`, `type/infer-program.ts`; fixtures
  `recursive-function-success` and `mutual-recursion-success`). There is no
  `letrec`, `loop`/`recur`, named `let`, or fixed-point form; `let` is not
  recursive.
- **Loops are stopped only by limits.** `(define f [x] (f x))` typechecks and
  runs as a tail call until `StepLimitExceeded`. Defaults: 50,000 steps for
  evaluation, 100,000 for form hooks and compile-time module code, and 10,000
  for descriptor typing hooks, meta-functions, and macro expansion. There is no
  wall-clock limit in the engine; `abortEvaluation` is checked only at host
  builtin calls ([RFC 0012](./0012-checked-evaluation.md) proposes a
  deadline).
- **Iteration builtins are finite.** `map`, `filter`, `reduce`, `sort-by`,
  `group-by`, `flat-map`, `some`, `every?`, and `pipe`
  (`builtins/collections.ts`, `builtins/control.ts`) walk the list or map they
  are given. There is no `range`, `iterate`, `repeat`, or `while`. Builtin
  loops are not metered; only evaluated closure bodies count steps.
- **Pure means no services.** Email rules and Elm updates and views are
  lowered to mechanics `FunctionDef`s with non-Effect results (`Email.ts`,
  `Elm.ts`). The mechanics checker rejects service calls
  (`mechanics/pure-service`), Effect-typed bodies (`mechanics/function-effect`),
  and effectful `:let` bindings (`mechanics/pure-binding`). Author-written
  definitions in the same source are added to the checked program, so rules
  can call them, and the checker collects every function signature before
  checking bodies, so self and mutual calls resolve.
- **No recursive data in mechanics.** The mechanics checker rejects recursive
  schemas (`mechanics/recursive-schema`) and constant cycles
  (`checkConstantCycles`), but not cycles between functions.
- **Gradual values.** `Unknown` unifies with anything in the HM checker and is
  assignable in both directions in the mechanics checker, so a value of that
  type can be applied to itself.
- **Exhaustiveness.** Missing constructors are errors in the mechanics
  checker and warnings in the HM checker (`type/infer-control.ts`).
- **No termination vocabulary.** No checker, document, or RFC mentions fuel, size
  change, or decreasing arguments. "Termination" appears only for type-level
  row solving in [RFC 0005](./0005-row-operations.md) and
  [RFC 0006](./0006-qualified-rows.md).

## Proposal

### Roots

The check runs only from roots that a consumer names:

- A pipeline such as `Email.ts` or `Elm.ts` passes the functions it lowers
  (each rule, `elm-update`, each `elm-view-N`) to the mechanics checker as
  termination roots.
- A form descriptor can mark a hole `:terminates`, so the expression in that
  slot, and what it references, is a root. This lets a prelude written in Forma
  ask for the check without TypeScript.
- A signature option, `(: f T :terminates)`, makes `f` a root and records the
  result in its interface. This is stage 3.

Code not reachable from a root is not checked, and kernel programs are
unaffected unless they opt in.

### Stage 1: acyclic references

From the roots, follow every reference to a definition: calls, function
values passed as arguments, record fields holding functions, typeclass
instance methods, and imports. The fragment terminates if:

1. the reference graph reachable from the roots has no cycle;
2. no expression of type `Unknown` is applied;
3. no user-declared recursive type is reachable; and
4. every builtin reached is in the terminating set (initially, all current
   kernel builtins).

Why this is enough: with no recursion through definitions and no recursive
types, what remains is a simply typed language with let-polymorphism and
finite-collection builtins, and such programs terminate (strong normalization
for System F covers the let-polymorphic fragment). Condition 2 rules out the
`Unknown` self-application that would otherwise type a fixed-point combinator,
and condition 3 rules out recursive types that would do the same. The
mechanics checker already rejects recursive schemas, so condition 3 matters
only for descriptor and signature roots in kernel code.

Violations:

| Code | Reported at | Details |
| --- | --- | --- |
| `termination/cycle` | the reference that closes the cycle | `cycle`: the definitions in order, from the root |
| `termination/gradual-call` | the application of an `Unknown` value | the root that reaches it |
| `termination/recursive-type` | the first use of the recursive type | the type and the root that reaches it |
| `termination/builtin` | the reference to a builtin outside the terminating set | the builtin name |

Messages name the root in the prelude's words. `Email.ts` already rewords
the mechanics service-call message for rules; it does the same for these codes.

### Stage 2: structural recursion

A self-recursive function is accepted when there is a parameter position such
that, in every recursive call, the argument in that position is a strict
part of the same parameter:

- a variable bound by a constructor pattern in a `match` on the parameter, or
  on a part already known to be smaller; or
- the rest variable of a vector pattern, `[first & rest]`, on the parameter.

Positions are tried left to right, as in Bend. Stage 2 also relaxes condition
3 for strictly positive recursive types, those whose recursive occurrences
never appear to the left of an arrow, because structural recursion over them
is well founded. Bend skips this check; Forma keeps it. Mutual recursion is not
accepted in this stage; a `termination/mutual` diagnostic suggests merging the
functions. Recursive data in mechanics programs needs `Schema.suspend` support
in the Effect generator first. Until then, stage 2 matters mostly for
list recursion through rest patterns and for kernel programs that opt in.

### Records

- `ModuleBinding` gains `terminates: "checked" | "unchecked"`.
- Mechanics `FunctionDef` payloads in artifacts gain the same field, so a host
  reading `ir.json` knows which functions were proved to halt.
- An [RFC 0019](./0019-specs-and-claims.md) claim with `:terminates` holds
  only when the definition checks as terminating.
- The [RFC 0021](./0021-artifact-verification.md) verifier can recheck
  stage 1 from the payloads, because the reference graph is in the bodies.

### What it does not promise

Termination is not a cost bound. A terminating view over a large model can
still take longer than a host allows, and builtin loops are not metered.
Step limits remain the defense against slow code, and
[RFC 0012](./0012-checked-evaluation.md)'s deadline remains the defense against
slow builtins. A terminating function can also fail: `fail`, arithmetic
errors, and, in the HM checker, non-exhaustive matches still end a call with a
failure instead of a value. The promise is that the call ends.

## Alternatives considered

- **Fuel.** Bend's server loops thread a `Nat` fuel argument. Forma already
  has a global step limit, which is fuel the author does not have to write.
- **Size-change termination.** Size-change analysis accepts more programs,
  including mutual recursion, but its results are harder to explain in a
  diagnostic. It could replace stage 2 later without changing the roots or
  records.
- **Totality as an effect.** Making divergence a row label would put
  termination in every type. The property matters at a few roots, so it is
  requested there.
- **Checking everything.** Kernel programs use recursion freely, and the
  prelude machinery runs under its own limits. An always-on check would reject
  working programs for no consumer's benefit.

## Implementation stages and validation

1. **Acyclic roots in mechanics.** Roots from `Email.ts` and `Elm.ts`, the
   reference graph, the three conditions, and the `termination/*` codes.
   Fixtures: a rule calling a helper, which is accepted; a rule calling a
   self-recursive helper; two mutually recursive helpers; a view applying an
   `Unknown` value; and a helper passed as a value into `map`, which is accepted.
   Every current email and Elm conformance case must still pass.
2. **Descriptor roots.** The `:terminates` hole option and its fixtures in
   `conformance/descriptor-metacheck/`.
3. **Structural recursion and signatures.** Stage 2 rules, the signature
   option for kernel definitions, and `terminates` in interfaces and
   artifacts. Fixtures for list recursion through `[first & rest]`, a call
   that passes the whole parameter, and a call that reorders arguments.
4. **Documentation.** Once stage 1 lands for a prelude, its page can state
   that rules or views terminate, replacing the current disclaimer.

## Decisions still required

- Whether new builtins must declare whether they terminate, and how host
  builtins reached from a root are treated. Today they are not in scope for
  pure fragments.
- Whether stage 2 should accept a decreasing `Int` argument guarded by a
  comparison with a constant, a common pattern that structural recursion
  rejects.
- Whether the HM checker's non-exhaustive match warning should become an
  error inside terminating fragments, so that "ends" means "returns a value
  or a declared failure".

## Related designs

Bend's [guide](https://github.com/bendlang/bend/blob/main/guide/GUIDE.md)
requires live recursion to pass parts obtained by pattern matching, reads
arguments left to right, forbids mutual recursion, and uses fuel for loops.
Agda and Rocq check structural recursion; Idris and Lean allow partial
definitions marked as such. Lee, Jones, and Ben-Amram's size-change principle
underlies Isabelle's and ACL2's termination analyses.
