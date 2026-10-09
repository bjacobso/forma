# RFC 0005: Type-level record operations

| | |
| --- | --- |
| Status | Closed-shape operations implemented in both engines; open-row constraints proposed |
| Created | 2026-10-09 |
| Scope | Record type projection, removal, disjoint composition, and discriminator collisions |

## Problem

Forma already infers row-polymorphic records. In TypeScript, `TRow` contains
`RExtend`, `REmpty`, or `RVar`; OCaml uses `TRecord` and `TOpenRecord`.
An annotation such as `{:name String & row}` describes a known field and an
unknown remainder. This lets ordinary functions consume records of different
shapes, but it does not provide record computation in the type language.

The ontology prelude computes query result types with
`(fn [{:keys [from select]}] (List (row-of from select)))`. That computation
reads declaration metadata and runs for each form application. A library
author cannot currently name a projection or disjoint composition in an
ordinary signature. Runtime `merge` also has overwrite semantics, which is
different from a composition whose type rules prohibit collisions.

The intended direction is to check generic record programs once, including
their assumptions about field absence. This change establishes the finite
operations and their diagnostics first. It does **not** establish that
stronger guarantee for programs generic over arbitrary record shapes.

## Prior art

[Ur (Chlipala, PLDI 2010)](https://adam.chlipala.net/papers/UrPLDI10/UrPLDI10.pdf)
makes field names first-class type-level objects and supports a type-level
`map` over records. Its `[r1 ~ r2]` disjointness assumptions allow generic
record concatenation to be checked without knowing the concrete fields.
Forma adopts disjoint composition as the goal, but this RFC does not adopt
Ur's full constructor language, type-level functions, or inference machinery.

[TypeScript's utility types](https://www.typescriptlang.org/docs/handbook/utility-types.html)
give familiar names to `Pick` and `Omit`. Forma uses literal keyword vectors
instead of key unions and deliberately makes missing `Omit` keys an error,
so misspelled fields cannot silently disappear.

[PureScript's `Prim.Row`](https://pursuit.purescript.org/builtins/docs/Prim.Row)
exposes row relations including `Union`, `Cons`, and `Lacks`. It illustrates
why field absence must be retained as a constraint rather than guessed from
the visible prefix of an open row.
[Koka's row-polymorphic effect types](https://www.microsoft.com/en-us/research/publication/koka-programming-with-row-polymorphic-effect-types/)
show how row inference can fit an ML-style language. Its duplicate effect
labels have a different purpose from Forma's uniquely named record fields;
effect-row rules should not be copied into record composition.

## Implemented surface

These forms are built-in type syntax in the HM checkers, not meta functions
or runtime operations:

```lisp
(type Person {:name String :age Int :active Bool})
(type Name (Pick Person [:name]))
(type PublicPerson (Omit Person [:age]))
(type IdentifiedPerson (Merge {:id String} PublicPerson))

(: name (-> Name String))
(define name [person] person.name)
```

Each form takes exactly two arguments. `Pick` and `Omit` take a record type
and a literal vector of distinct keywords. `Merge` takes two record types.
Aliases and nested operations are resolved before checking the outer shape.
Only closed shapes are supported. Field *types* may remain polymorphic:

```lisp
(type (Envelope a) (Merge {:value a} {:id Int}))
(: read (-> (Envelope a) a))
(define read [record] record.value)
```

Whole-record variables and open tails are rejected at the operation operand,
even when a particular operation could be partially simplified. For example,
`(Pick {:name String & row} [:name])` is currently rejected, as is
`(type (Selected r) (Pick r [:name]))` at its declaration. A later concrete
instantiation does not make an otherwise invalid generic alias valid.
Open rows remain available in ordinary signatures outside these operations.

The key vector is syntax, not a value expression. There is no key-variable
kind, `keyof`, value-dependent selection, field renaming, or string-key
selection. Fields not selected by `Pick` do not appear in the result.
`Omit` removes exactly its listed fields. Both preserve the retained types,
including `Option` fields and nested record types. Empty vectors are allowed.
`Merge` is a disjoint union: even equal types at the same field are a collision.
Empty records are its identity. Field order has no semantic significance.

These operations do not perform runtime projection, change runtime `merge`,
or add Effect schema/code generation support. Their shipped surface is
ordinary HM type aliases, ascriptions, and signatures.
The existing contextual Option coercion reads explicit record syntax rather
than normalized HM types. For computed record annotations, optional fields
must currently be supplied explicitly as `Some` or `None`; automatic wrapping
and insertion of omitted fields are deferred.

## Normalization and inference rules

Write a closed record as a finite map `R : Label -> Type`, and `K` as the
set of literal keys in a vector. Let `dom(R)` be its labels.

```text
R is a closed record     K ⊆ dom(R)     keys are distinct
--------------------------------------------------------
Pick R K  ⇓  { l : R(l) | l ∈ K }
Omit R K  ⇓  { l : R(l) | l ∈ dom(R) \ K }

A and B are closed records     dom(A) ∩ dom(B) = ∅
------------------------------------------------
Merge A B  ⇓  A ∪ B
```

If an operand is a type variable or has an open tail, normalization fails;
there is no deferred obligation in this slice. If it is a nominal type,
dictionary, union, scalar, or function, it is not a structural record operand.
Nested computations normalize inside out. Aliases use the existing alias
resolution and substitution rules; an operation does not unfold arbitrary
recursive field types to discover additional labels.

The parsed type AST has a dedicated row-operation node, including each key's
span. Normalization produces existing record types. HM unification,
generalization, instantiation, and the existing directional assignment rules
then run unchanged. In particular, field variables are reused rather than
freshened by projection. No equation is solved backwards: checking a value
against `(Pick R [:a])` does not infer the missing shape of `R`.
There are no user-defined reduction rules or type-level recursion. Apart
from existing alias resolution, reduction traverses finite syntax and finite
field maps, keeping inference predictable.

## Proposed open-row constraints (not implemented)

The eventual signature form should separate propositions from result types:

```lisp
; Proposed only: this signature is not a shipped feature.
(: combine
  (Where [(Disjoint {& left} {& right})]
    (-> {& left} {& right} (Merge {& left} {& right}))))
```

`Disjoint A B` asserts that the *entire* domains of the records are disjoint,
including their unknown tails. `Where` qualifies a type; it is not a record
constructor or a runtime check. A future implementation should:

1. Introduce row-domain constraints distinct from typeclass instance search.
   Keep row variables and ordinary type variables in their existing namespaces.
2. Reduce closed disjointness by label intersection. For an open row, propagate
   a lacks obligation for each visible label to the opposite tail and retain
   the relation between unknown tails. Equal unknown tails are not evidence
   of disjointness; only an empty domain can be disjoint from itself.
3. Retain symbolic operations until their inputs normalize. `Pick` needs
   presence constraints; `Omit` must ensure removed labels cannot reappear
   through the residual tail. `Merge` needs a disjointness proof.
4. Include obligations in free-variable collection, generalization,
   instantiation, substitution, and exported module signatures. Check an
   annotated generic body under its declared assumptions once, and check
   those assumptions at each use.
5. Preserve the author operation/constraint span through substitution. Fail
   an unsolved monomorphic obligation at the boundary; never silently erase
   it, choose an arbitrary row, or weaken it to `Any`/`Unknown`.

Termination should come from a finite collection of built-in relations and
decomposition of finite row prefixes, with no user-defined rewrite rules.
Principal inference for unrestricted row equations is not a goal. Rules for
ambiguous exported constraints and higher-rank use need a separate design
and fixtures before enabling this syntax.

[RFC 0006](./0006-qualified-rows.md) develops this proposal into a rank-one
constraint design, including generic value primitives and portable schemes.
It remains proposed, not part of the implemented closed-shape operations.

### Why this slice rejects unknown shapes

Neither engine currently records record-domain lacks constraints in schemes.
TypeScript's existing pending constraints are for typeclasses; OCaml's scheme
constraints likewise describe instance obligations. Seeing no shared field
in two open prefixes does not prove disjointness: their tails can later acquire
the same label. Merely concatenating the prefixes would accept an unsound
signature. Introducing symbolic rows and retaining their obligations across
both engines and module boundaries is a larger change than finite type
normalization. Closed-shape operations therefore ship first, with explicit
rejection rather than a misleading partial implementation of `Disjoint`.

## Diagnostics and tagged payloads

Row-operation failures use `typecheck/row-operation` in both engines:

| Error | Author span |
| --- | --- |
| Wrong arity | Entire operation |
| Keys are not a vector | Key argument |
| Non-keyword or repeated key | Invalid or second occurrence of key |
| Missing `Pick`/`Omit` field | Key |
| Non-record or unresolved operand | Operand |
| Open operand | Operand |
| `Merge` collision | Entire merge |

For example, `(Merge {:a Int} {:a Int})` reports
`Merge requires disjoint records; duplicate field :a`.
An unresolved operand reports that a known closed record shape is required;
an open operand reports that open-row constraints are unsupported.

`Tagged` constructors merge *inline record payloads* with the discriminator
(`:_tag` by default, or the field selected with `:tag`). A payload declaring
that field is now rejected, including when its type agrees with the tag.
An inline open payload is also rejected because its tail could collide.
These errors use `surface/invalid-form` and point to the payload's conflicting
field or `&`. Scalar payloads continue to use `:value`.
This change does not alter the existing representation of alias or computed
payload syntax: only literal record payloads use the inline merge path.

## Prelude use and compatibility

The `query` result hook and the public `row-of` meta builtin remain unchanged.
`from` is a reference to a schema declaration, not an HM record type, and
`select` is captured optional symbol syntax, not a literal keyword vector in
a type signature. `row-of` resolves declaration fields, unwraps their type
metadata, and selects all declared fields when selection is absent or empty.
Its TypeScript implementation currently lives in `surface/form.ts`; OCaml
implements it in `eval_syntax.ml`. Substituting `(Pick from select)` would lose those
behaviors and would not cross the metadata/type boundary correctly.

A future migration requires a generic, domain-neutral way to reify a
declaration's field types and literal selection into type syntax, followed by
normalization through the same type checker. It also requires checking form
result hooks under row constraints if the goal is verification once for all
shapes. Defining ontology-specific types in the compiler would violate the
prelude boundary. `http-api.lisp` currently builds schemas and declaration IR,
so this HM-only slice provides no sound simplification there either.
No prelude result types, emitted schemas, or artifacts change in this slice.

## Conformance and delivery

`conformance/row-operations/` contains positive and negative author programs.
Their entries in `conformance/engine-parity/cases.json` include expected
normalized types or diagnostics with source ids and exact offsets. The
TypeScript tests consume those same entries and also check diagnostic prose.
The parity runner checks each engine against the goldens as well as against
each other, so two engines agreeing on a failure cannot pass a positive case.
The parity runner retains its existing policy of ignoring diagnostic prose
when comparing engines.

Full `pnpm check`, native tests, and `pnpm parity:engines` are the verification
gates. Any inability to run them must be reported separately from implemented
behavior. The changeset covers both engine packages.

## Full rollout proposals

The following RFCs cover the remaining bounded row-language rollout. Their
acceptance criteria are separate from this RFC's implemented slice; none of
their new syntax is implemented merely by documenting it here.

| Proposal | Capability | Dependency and completion gate |
| --- | --- | --- |
| [0006: Qualified rows](./0006-qualified-rows.md) | Open-row presence, absence, disjointness, symbolic operations, and generic record primitives | After 0005; obligations survive generic body checks and module imports in both engines |
| [0007: Shared normalization](./0007-type-normalization.md) | Computed record coercion, type values, schemas, and opt-in tagged flattening | Closed consumers can follow 0005 independently; symbolic consumers need 0006; existing artifacts remain unchanged |
| [0009: Field names and row map](./0009-field-names-and-row-map.md) | Key-set indices for selection, then field-name parameters and bounded unary mapping | After 0006; key indices land before checked form templates; mapping is a later independent stage |
| [0008: Typed form results](./0008-typed-form-results.md) | Domain-neutral reflection and checked declarative result families | Reflection bridge follows 0007; generic templates need 0006 and 0009's key indices; old/new query types and artifacts agree |

The critical path to the ontology migration is qualified rows plus shared
normalization, then validated reflection and key-set indices, then checked
templates. Row mapping is useful library work but is not a prerequisite for
`query`. A reflection-backed `row-of` alone does not meet the stronger goal of
checking a generic template once.

Each stage requires independent conformance goldens, author-span diagnostics,
explicit implementation/parity status, and changesets for package behavior
changes. A TS-only intermediate stage must be documented as a language difference.
The rollout does not promise full Ur compatibility: unrestricted type-level
functions, dependent runtime selection, and arbitrary row-equation inference
remain outside these proposals.

## Out of scope and remaining work

- Open-row `Disjoint`/`Where`, symbolic operations, and lacks/presence solving.
- Replacing `query`'s `row-of`, or claiming generic metaprograms are checked
  once for every possible schema.
- Effect schema/code generation and descriptor type-value normalization.
- Contextual Option wrapping and filling for computed record annotations.
- First-class field-name variables, row `map`, computed key sets, field
  renaming, type-level lambdas, and dependent types.
- A runtime disjoint merge primitive, changes to ordinary runtime `merge`,
  or global changes to the existing open-row unifier.
- Changing the payload representation of `Tagged` aliases or computed types.

These are deferred from this implementation, not engine parity gaps in the
closed-shape rules. RFCs 0006–0009 propose bounded follow-ups; their explicit
exclusions, including general field renaming and type-level lambdas, remain
outside the rollout.
