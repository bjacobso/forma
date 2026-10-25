# RFC 0020: Tracking unchecked assumptions

| | |
| --- | --- |
| Status | Proposed; not implemented |
| Created | 2026-10-25 |
| Scope | Trust facts for gradual `Unknown` uses, host-declared types, and untyped prelude helpers; transitive closure over references; interface and artifact summaries; host policy |
| Direction | Every definition reports which of its guarantees rest on something the checker did not check, including through what it references |

## Summary

The checker records a **trust fact** wherever a type is assumed rather than
checked: a value of type `Unknown` used as a specific type, a call to a host
builtin whose type the host declared, or a reference to a prelude helper the
checker does not type. Facts are attached to the enclosing top-level
definition and closed over references, so a definition that calls one that
assumes something assumes it too:

```text
order-summary   assumes   gradual via format-lines (lines.forma:12:5)
format-lines    assumes   gradual (lines.forma:12:5): meta/get result used as String
line-total      checked
```

Module interfaces and artifacts carry the summary. A host can deny a kind of
fact, which turns it into an error at its source span. Nothing changes types,
generated code, or evaluation.

## Motivation

A checked Forma program is only as checked as its weakest dependency. Three
kinds of type in the engine are assumed, not verified: the gradual
`Unknown`, which unifies with anything; schemes a host declares for its
builtins; and helpers the descriptor metacheck owns, which user code sees as
`Unknown`. A definition that touches one can still be wrong in the way the
type system would otherwise rule out, and nothing tells the author, reviewer,
or host that it did.

Bend marks unchecked definitions with `@unsafe`. A check then prints
`SOME PROOFS FAIL` and names every definition that depends on one. The
mark is explicit, and its effect is transitive and visible.

Forma already makes authority visible through requirement sets. Trust needs
the same visibility. It cannot reuse requirement sets directly: those are
modular, because each signature declares its requirements and callers use the
signature. A signature cannot declare an assumption away. `Int -> Int` says
nothing about whether the body used an `Unknown`. Trust must be computed from
bodies and closed over the reference graph, the way the workbench closes
capabilities over symbols.

## Current state

- **Gradual `Unknown`.** `tUnknown` (`packages/ts/src/type/types.ts`)
  unifies with anything (`type/unify.ts`). Authors can write `Unknown`
  (`surface/type-syntax.ts`). It also comes from:
  - kernel builtin schemes for `meta`, `meta/get`, `attribute-type`,
    `declaration-hole`, `type/kind`, `type/base`, `keyword/name`, and
    `keyword`, and the variadic arguments of `str` and `format`
    (`type/builtin-schemes.ts`);
  - DSL forms without a declared result type (`type/infer-dsl.ts`);
  - host schemes written as `any` (`engine/operations.ts`);
  - non-symbol entries in a `RequirementSet`;
  - `Any` and `_` in descriptor meta types (`descriptor/meta-types.ts`).

  In the mechanics checker `unknown` is assignable in both directions
  (`mechanics/types.ts`).
- **Host builtins.** `HostBuiltinDescriptor` (`packages/host/src/types.ts`)
  has an optional `typeScheme`, converted to a monomorphic scheme by
  `builtinSchemeFromRequest` (`engine/operations.ts`). Its implementation is
  host code. Its `effect` and `purity` fields do not reach the checker.
- **Prelude helpers.** `descriptorTypingInputs`
  (`engine/session-validation.ts`) removes `form`, `__form-descriptor`,
  `__form-hook`, `__elaboration`, and `__payload-contract` forms and the
  helpers they reach from HM checking, because "the descriptor metacheck owns
  these bodies." Those helpers are typed `Unknown` in the prelude scope, so
  user code that calls one gets an unchecked result.
- **Things that are checked, but differently.** Macro expansions are checked
  after expansion. Form construction bodies are not HM-typed, but their result
  is checked against `:ir` with `contractErrors` before elaboration continues
  (`surface/form.ts`). Option coercion is a rewrite whose result is checked.
  `assert-valid` checks a value against a schema at run time.
- **Kernel builtins.** Implementations in `builtins/*.ts` are trusted
  relative to their schemes. Nothing checks one against the other.
- **Propagation precedents.** Requirement sets are checked per signature
  (`mechanics/check.ts`, `type/assign.ts`). The only transitive closure over
  definitions is the workbench's `requirementsFor`
  (`packages/workbench/src/requirements.ts`), a fixpoint over syntax seeded
  from capability symbols, outside the engine.
- **No record.** No declaration, scheme, interface, or artifact has a trust
  status. Artifact declarations record source, span, and macro origin
  (`artifact/artifact.ts`), not the hooks or helpers they relied on.

## Proposal

### Trust facts

```ts
type TrustFactKind = "gradual" | "host-declared" | "prelude-helper";

interface TrustFact {
  readonly kind: TrustFactKind;
  readonly span: Span;                 // author source where the assumption enters
  readonly subject?: string;           // builtin or helper name, when there is one
  readonly detail?: string;            // e.g. "meta/get result used as String"
}
```

| Kind | Recorded when |
| --- | --- |
| `gradual` | A value whose synthesized type is or contains `Unknown` is checked against, or unified with, a type that is not `Unknown`. An author-written `Unknown` annotation on a definition is also recorded. |
| `host-declared` | A call to a host builtin. Its type is the host's declaration; its implementation is host code. |
| `prelude-helper` | A reference to a helper excluded from HM checking by `descriptorTypingInputs`. |

The direction of a `gradual` fact matters. Passing an `Int` to a parameter
typed `Unknown`, as `str` accepts, assumes only that the builtin handles any
value, which is part of its trusted implementation. It is not recorded.
Using an `Unknown` result as an `Int` is recorded, because a wrong value can
flow on from there. In stage 1, facts are recorded where the checker knows
which side is the value: application arguments, `checkExpr` against an
annotation, `match` scrutinees, and record field access. Other unifications
that solve a variable to or against `Unknown` are recorded at the enclosing
form with `detail: "unification"`.

Kernel builtins are not facts. They are the trusted base, listed once per
artifact (below), not at each use.

### Closure

Each top-level definition has direct facts from its own body. Its summary
closes over every definition it references, not only the ones it calls:
module definitions, imports, typeclass instance methods, and layer methods.

```ts
interface TrustSummary {
  readonly status: "checked" | "assumes";
  readonly direct: readonly TrustFact[];
  readonly via: readonly {
    readonly identity: BindingIdentity;          // the referenced definition
    readonly kinds: readonly TrustFactKind[];
  }[];
}
```

`via` lists the nearest referenced definitions that carry facts, not the whole
path, so a summary stays small and a reader follows it one step at a time.
Recursive groups share one summary. Across modules, the closure uses the
dependency's exported summaries.

### Where summaries appear

- **Analysis.** `AnalysisWorkspace` exposes summaries per definition. Hover
  shows "assumes gradual via format-lines". The language server reports
  direct facts as `info` diagnostics, code `trust/<kind>`, at their spans.
  Facts reached only through references are not reported at each use.
- **Interfaces.** `ModuleBinding` gains `trust: TrustSummary`. A host or a
  reviewer can see which exports rest on assumptions without reading bodies.
- **Artifacts.** Each packaged declaration produced from a definition gains a
  `trust` summary. The envelope gains `trustBase`, listing the engine version,
  prelude fingerprint, and every host builtin the declarations reference,
  with its declared scheme. A consumer of `ir.json` can review exactly what
  the artifact assumes.
- **Verdicts.** A claim that holds under [RFC 0019](./0019-specs-and-claims.md)
  lists its trust facts as `assumptions`, and the rendering prints
  `holds, assuming gradual (2)`.

### Policy

A session option denies kinds of fact:

```ts
interface TrustPolicy {
  readonly deny?: readonly TrustFactKind[];
}
```

A denied fact is an error, `trust/denied`, at the fact's span, with the
kind in `details`. Through a reference, the error is reported at the
referring expression and names the definition that carries the fact. The
default policy denies nothing. [RFC 0012](./0012-checked-evaluation.md)'s
checked run accepts a policy, so a host can refuse model-written source that
uses `Unknown`.

## Alternatives considered

- **A requirement label.** Encoding trust as an `Unchecked` requirement would
  reuse inference and set checking. But the requirement check would then
  force every signature on the path to declare it, changing interfaces and
  generated Effect TypeScript for a property that does not affect callers'
  types. Trust is about bodies, not interfaces.
- **An explicit `unsafe` marker.** Bend makes the author write `@unsafe`.
  Forma's escape hatches are already explicit in their own way: writing
  `Unknown`, declaring a host builtin, calling a helper. Recording those is
  enough; a separate marker would add a way to say what is already said.
- **Removing the escape hatches.** Typing prelude helpers and replacing
  `Unknown` in builtin schemes would reduce the facts, and should happen where
  it can. Some facts will remain, because hosts declare types for code
  outside Forma.
- **Brands.** `(Brand N Base)` registers an unchecked constructor. This is
  deliberate nominal typing, not an assumption the checker could verify, so
  it is not a fact (see decisions).

## Implementation stages and validation

1. **Facts and closure in the HM checker.** Recording `gradual`,
   `host-declared`, and `prelude-helper` facts, per-definition summaries, and
   the closure, including recursive groups. Fixtures with reviewed
   summaries: a direct `Unknown` use, a parameter-only `Unknown` that records
   nothing, a fact two references away, a recursive group, and a host builtin.
2. **Modules and artifacts.** `trust` in `ModuleBinding`, closure across
   imports, `trust` on packaged declarations, and `trustBase`, pinned in
   `conformance/modules/` and `conformance/artifacts/`.
3. **Mechanics.** Facts for `unknown` in the mechanics checker, so Effect
   programs report the same summaries.
4. **Policy and tools.** `TrustPolicy`, `trust/denied`, hover, `info`
   diagnostics, and RFC 0019 assumptions.

## Decisions still required

- Whether brand constructors applied outside a validating function should be
  a fact kind.
- Whether kernel builtins with `Unknown` in their result types, such as
  `meta/get`, should be typed precisely before this lands, which would remove
  most `gradual` facts in preludes.
- Whether the closure should include definitions referenced only from
  compile-time code, such as form hooks that ran to produce a declaration.
- Whether `info` diagnostics for direct facts are useful by default or only
  when a policy is set.

## Related designs

Bend's [guide](https://github.com/bendlang/bend/blob/main/guide/GUIDE.md)
lets `@unsafe` skip checking for a definition and reports every definition
that depends on one. Rust's `unsafe` blocks mark code whose guarantees the
author asserts. Gradual type systems, such as TypeScript's `any` and Typed
Racket's boundaries, show how a single unchecked value spreads; Typed Racket
records blame at the boundary where it enters.
