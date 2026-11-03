# RFC 0018: Type generics and collection inference

| | |
| --- | --- |
| Status | Proposed; exploration, not implemented as a complete contract |
| Created | 2026-11-02 |
| Scope | Rank-one generic signatures, callback/result inference, generic aliases, collection contracts, module and tooling behavior |
| Direction | Reuse Forma's existing type variables and inference; make explicit generic signatures promises that bodies must satisfy |

## Summary

A generic function describes a relationship between types. For `map`, the
input elements have type `a`, the callback accepts `a` and returns `b`, and
the result contains elements of `b`:

```lisp
(: map (-> (-> a b) (List a) (List b)))
```

If the callback returns its input, `b` is the same as `a`. If it returns a
string, the result is a list of strings. These are instances of one signature;
`map` needs no special rule to choose between them.

Forma already implements this built-in signature and Hindley–Milner inference.
This RFC explores the author-facing contract around that foundation: how to
write generic helpers, check their declarations, infer calls, preserve generic
types through modules, and explain mistakes. Examples use `(List T)`, Forma's
canonical type for values such as `[1 2 3]`; this is the collection a reader
coming from JavaScript might call an array.

## Current behavior and gaps

The following behavior exists in the current TypeScript engine:

- `builtin-schemes.ts` quantifies independent input and result variables for
  `map`. `filter` and `reverse` preserve the input element type.
- Unannotated helpers such as `(define identity [x] x)` generalize their types
  at binding boundaries. Each use receives fresh variables.
- Lowercase names in signatures, such as `a` and `b`, become type variables.
  Repeated names within a signature refer to the same variable.
- Generic aliases use explicit parameters, for example
  `(type (Box a) {:value a})`.
- File modules already preserve polymorphic functions and instantiate imports
  independently. Generated Effect TypeScript supports a documented subset of
  inferred polymorphic pure functions; generic schemas remain unsupported.

However, an annotated definition currently checks against fresh, flexible
variables. It can specialize a supposedly generic signature to fit its body:

```lisp
; Current checker accepts this and infers Int -> Int.
(: keep (-> a a))
(define keep [value] 0)
```

That signature should promise that `keep` works for every `a`. Returning `0`
cannot satisfy it for strings or records. Strengthening this check is proposed
work, also needed by [RFC 0006](./0006-qualified-rows.md).

Runtime collection support is broader than the dedicated static contracts.
For example, `flat-map` exists in the evaluator but has no dedicated case in
`builtin-schemes.ts`. Supporting an operation at runtime does not establish a
precise generic signature for it.

All rules below describe the proposed contract. Some examples already work;
acceptance requires fixtures for the complete contract rather than assuming
that parser acceptance establishes support across every consumer.

## Author-facing design

### Keep lowercase type variables and inference

Use the existing syntax, with implicit universal quantification at the outer
binding signature. No new `Generic`, `ReturnType`, or `Array` type is needed.

```lisp
(: identity (-> a a))
(define identity [value] value)

(: transform (-> (-> a b) (List a) (List b)))
(define transform [f values] (map f values))

(: retain (-> (-> a Bool) (List a) (List a)))
(define retain [predicate values] (filter predicate values))
```

`a` and `b` are independent parameters, but may instantiate to the same type.
Names are local to each signature: `a` in `identity` has no connection to `a`
in `transform`. Type names such as `String` refer to declared or built-in
types; term bindings never become type parameters implicitly.

Signatures remain optional. Omitting the signature on `transform` should infer
the same input/result relationship. A written signature can intentionally
restrict a helper to a concrete type, but a generic signature must retain
every relationship it declares.

### Infer map's output from its callback

```lisp
(map (fn [value] value) [1 2 3])
; (List Int)

(map (fn [value] (str value)) [1 2 3])
; (List String)

(map (fn [value] {:value value}) [1 2 3])
; (List {:value Int})

(map (fn [value] [value]) [1 2 3])
; (List (List Int)) -- map does not flatten

(map (fn [user] user.name) [{:name "Ada"} {:name "Grace"}])
; (List String)
```

At each call, instantiate fresh `a` and `b`. Check the collection against
`(List a)` and the callback against `(-> a b)`, using both arguments and any
expected result type to solve those variables. A callback written before the
collection must still receive information from the collection. Its body can
constrain `a` too: mapping `upcase` over integers is a type error.

This is ordinary type inference, not evaluation of the callback during checking.
An empty input still has the callback's static result type:

```lisp
(map (fn [value] (str value)) [])
; (List String), despite the callback never running

(: empty-names (List String))
(define empty-names (map (fn [value] value) []))
; The expected result supplies the otherwise unknown element type.
```

Without a callback or context that fixes an empty collection's element type,
retain an inference variable and apply the existing binding generalization
rules. Do not default it to `Unknown`, `Unit`, or an invented element type.
A consumer that needs a concrete schema must request a concrete instantiation.

Each collection has one element type. This proposal adds no tuple inference,
automatic arbitrary union widening, or preservation of literal collection
length. Existing literal and union rules continue to decide which elements
have a common type.

This `map` transforms runtime list values. The proposed `MapFields` in
[RFC 0009](./0009-field-names-and-row-map.md) computes record field types and
has separate rules; it is not required for generic list traversal.

### Generic data uses the same parameters

```lisp
(type (Box a) {:value a})

(: box (-> a (Box a)))
(define box [value] {:value value})

(: map-box (-> (-> a b) (Box a) (Box b)))
(define map-box [f boxed] {:value (f boxed.value)})
```

Alias application substitutes its arguments without conflating independent
uses. Alias arity must match, and normalization must retain the relationship
between the alias's parameters and its fields. Generic alias checking must
reject unbound parameters in its body rather than inventing extra parameters.
Recursive alias policy remains separate from this proposal.

## Checking generic promises

For an explicit generic signature, introduce rigid parameters while checking
the body. A rigid `a` stands for an arbitrary type; it cannot unify with `Int`
merely because the body returns an integer. Check the body once, then publish
the declared scheme. Instantiate that scheme with fresh, flexible variables
at each use.

This distinguishes two legitimate behaviors:

```lisp
; Infer a specialized function: valid, returns Int regardless of input.
(define zero [value] 0)

; Assert an input/result relationship: invalid implementation.
(: wrong (-> a a))
(define wrong [value] 0)

; Assert independent arbitrary input and result: also invalid.
(: impossible (-> a b))
(define impossible [value] value)
```

An implementation cannot manufacture an arbitrary `b`, inspect a type
parameter to choose a runtime branch, or assume an undeclared field on `a`.
Constrained record helpers belong to RFC 0006; numeric and other constrained
operations must retain their existing constraints rather than treating an
unconstrained variable as supporting every operation.

Generalize only variables that are not free in the surrounding environment.
A closure must not acquire fresh types for values captured from an outer
scope. Function parameters remain monomorphic within a body. Recursive and
mutually recursive definitions use monomorphic recursive references during
checking; polymorphic recursion is outside this RFC.

This is rank-one polymorphism: quantification belongs to a binding, not inside
an argument or record field. Passing `identity` to `map` instantiates it for
that call; it does not require a callback that is itself universally quantified.
Higher-rank callbacks and higher-kinded constructor parameters are deferred.

## Collection contracts and effects

The initial pure contracts are:

| Operation | Signature | Relationship |
| --- | --- | --- |
| `map` | `(-> (-> a b) (List a) (List b))` | Callback determines output elements |
| `filter` | `(-> (-> a Bool) (List a) (List a))` | Predicate preserves element type |
| `reverse` | `(-> (List a) (List a))` | Order changes, element type stays |
| `flat-map` | `(-> (-> a (List b)) (List a) (List b))` | Callback returns lists; flatten one level |

The first three have dedicated built-in schemes today. The `flat-map` scheme
is proposed. Audit runtime and VM behavior before advertising each contract;
a callback returning a scalar must fail the proposed `flat-map` contract.

The signatures above describe pure callbacks. They do not settle effect-row
syntax. [RFC 0003](./0003-direct-style-effects.md) requires higher-order
functions to propagate callback effects. When that work lands, `map` must
retain independent element types while also quantifying the callback's effect
row. A pure callback produces a pure traversal; an effectful callback cannot
silently produce a pure function. Traversal remains sequential and preserves
element order. Parallel traversal needs an explicit operation.

## Modules, tooling, and runtime boundaries

Preserve quantified variables and their repeated occurrences in portable
module schemes, using the existing module contract. Import, aliasing, and
re-export must preserve the scheme; every use must instantiate it afresh.
Inference-session IDs must never become public parameter identities.

Hover should show a stable generic relationship such as
`(-> (-> a b) (List a) (List b))`, and a call result should show its resolved
type, such as `(List String)`. Display spelling may differ, but must preserve
which occurrences refer to the same variable. Unresolved variables must remain
visible rather than being displayed as a concrete type.

Generic type arguments are erased for ordinary evaluation. No runtime type
dispatch or per-element schema inspection is added. Concrete schema generation
still requires supported concrete types. As in
[RFC 0011](./0011-signatures-as-contracts.md), a generic function is not
automatically a callable JSON tool with a concrete schema. Generic schema
factories and a public syntax for explicit call-site type arguments remain
separate decisions.

## Diagnostics and compatibility

When a callback expects strings and receives integers, report the mismatch at
the offending callback or collection argument, with the conflicting expected
and actual element types. When an explicit generic body specializes a rigid
parameter, report the body expression and relate it to the generic signature.
Keep author spans through alias expansion and imported schemes.

Prefer existing type mismatch diagnostics where they accurately describe the
failure. A dedicated generic-signature code, if introduced, must have fixtures
and follow [RFC 0017](./0017-diagnostic-catalog.md) when its catalog lands.

Rejecting previously accepted specialized generic annotations is an intentional
behavior change. Authors can remove the signature to infer the actual function
or replace it with a truthful concrete signature. Existing correctly inferred
helpers and correct generic signatures should retain their types and runtime
behavior. Record any behavior change in a changeset at implementation time.

## Delivery and acceptance

1. **Pin the foundation.** Add meaningful inference fixtures for same-type and
   changed-type `map`, record and nested-list results, callback/input mismatch,
   empty inputs, expected result types, and independent uses of a helper.
   Confirm current behavior before assigning implementation status.
2. **Check generic signatures rigidly.** Cover valid `identity`, `transform`,
   `box`, and `map-box`; reject `wrong`, `impossible`, undeclared field access,
   captured-variable generalization, and escaping rigid variables. Check both
   signature placements supported by the language and recursive groups.
3. **Complete collection contracts.** Add a precise `flat-map` scheme and
   positive/negative fixtures, including a scalar callback result. Confirm
   evaluator/VM agreement and unchanged sequential order. Effect propagation
   remains gated on RFC 0003's implementation.
4. **Check public boundaries.** Export, import, and re-export one generic
   helper; use it at unrelated types in the same consumer and separate
   consumers. Cover generic aliases, arity failures, stable hover names, and
   concrete-schema rejection for unresolved parameters. Validate generated
   TypeScript only for the supported pure subset.

Use semantic inference tests and source-spanned surface fixtures, review any
golden changes, and run `pnpm check`. Keep the language guide and agent docs
explicit about which stages have shipped. Acceptance of this RFC alone does
not implement any stage.

## Alternatives and open questions

- **Explicit quantifiers.** A binder such as `(Forall [a b] ...)` could make
  scope clearer and catch misspelled lowercase variables. The initial direction
  keeps the existing implicit syntax; decide whether an optional explicit
  binder earns its additional syntax before implementing one.
- **Explicit call-site arguments.** Context and argument inference cover the
  motivating examples. Decide on a syntax only when a concrete API needs type
  arguments that cannot be supplied through an expected type.
- **Callback return-type operators.** A `ReturnType` operator adds type-level
  machinery without helping `map`: `b` already names the callback's result.
  Consider it separately if reflection over named function types becomes useful.
- **Collection abstraction.** A single `map` over arbitrary constructors would
  require more than `(List a)`. Keep higher-kinded abstractions, collection
  shape preservation, and typeclass design outside this initial contract.
- **Effect integration.** Decide the public notation for generic callback
  effects with RFC 0003; do not assign purity merely because an element-type
  signature omitted effect syntax.
