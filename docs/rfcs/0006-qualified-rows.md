# RFC 0006: Qualified rows and generic record programs

| | |
| --- | --- |
| Status | Proposed; not implemented in either engine |
| Created | 2026-10-09 |
| Depends on | [RFC 0005](./0005-row-operations.md) |
| Scope | Row constraints, symbolic operations, generic bodies, and module contracts |

## Problem and outcome

RFC 0005 computes `Pick`, `Omit`, and disjoint `Merge` for closed record
shapes. It deliberately rejects open operands because neither engine retains
record-domain obligations in generalized schemes. Comparing only the visible
fields of two open records would miss collisions introduced through their tails.

This proposal lets a library check a record program once under explicit
assumptions. Every instantiation must satisfy those assumptions, including
when the function crosses a module boundary. A caller gets an error at its
arguments instead of a silently overlapping record or an expansion-time failure.

All syntax and behavior below are proposed. The prior art and closed-shape
semantics remain those of RFC 0005.

## Surface and meaning

```lisp
; Proposed: these examples do not run today.
(: combine
  (Where [(Disjoint {& left} {& right})]
    (-> {& left} {& right} (Merge {& left} {& right}))))
(define combine [left right] (merge-disjoint left right))

(: name-only
  (Where [(Has {& row} :name String)]
    (-> {& row} (Pick {& row} [:name]))))
(define name-only [record] (pick-record record [:name]))

(: add-id
  (Where [(Lacks {& row} :id)]
    (-> {& row} (Merge {:id Int} {& row}))))
(define add-id [record] (merge-disjoint {:id 0} record))
```

`Where` qualifies a rank-one type with a finite vector of built-in predicates:

| Predicate | Meaning |
| --- | --- |
| `(Has R :label T)` | The entire record `R` contains that label with type `T` |
| `(Lacks R :label)` | The label occurs nowhere in `R`, including its tail |
| `(Disjoint A B)` | The entire domains of `A` and `B` do not overlap |

Predicates are compile-time facts with no runtime dictionaries or instance
search. They are separate from Forma's typeclass constraints. Labels remain
literal keywords. Whole-record variables are written using existing row syntax
`{& row}`; field types retain ordinary type variables. Both engines must enforce
these roles, even though OCaml currently represents open tails using type variables.

Initially `Where` is permitted only at the outermost level of binding signatures
and generalized module schemes. Predicates cannot be nested in function arguments
or stored in record fields. Generic aliases may contain symbolic operations;
using such an alias introduces its operation obligations into the enclosing
binding. Aliases do not hide or discharge those obligations.

## Constraint solving

The solver maintains assumptions for an annotated body and obligations for uses.
Ordinary unification first supplies information about operands. A finite worklist
then simplifies predicates and operations; it does not enumerate record shapes.
Field access on an abstract record introduces a `Has` obligation and uses the
available assumptions; it cannot extend a rigid annotated row to make the access
work. Known literal records continue to expose their fields directly.

For a record `{l : T & tail}`, the representation must also retain `Lacks tail l`.
Otherwise an inferred tail could reintroduce an existing field. This invariant
applies to ordinary open-record construction and unification, not just `Merge`.
Introducing it is an explicit extension of RFC 0005's limited checker changes.

| Relation | Forward simplification |
| --- | --- |
| `Has {l:T & r} l U` | Unify `T` and `U` |
| `Has {l:T & r} k U`, `k != l` | Require `Has {& r} k U` |
| `Lacks {l:T & r} l` | Contradiction |
| `Lacks {l:T & r} k`, `k != l` | Require `Lacks {& r} k` |
| `Disjoint {l:T & r} B` | Require `Lacks B l` and `Disjoint {& r} B` |
| `Disjoint {} B`, `Lacks {} l` | Satisfied |
| `Has {} l T` | Missing field |

Disjointness is symmetric. Two unknown tails retain a relation; absence of a
visible collision is insufficient. Repeated facts are deduplicated. Equal
unknown tails do not prove disjointness and the solver must not choose the empty
row merely to satisfy an obligation. A declared relation between identical
tails can only be instantiated with a domain that actually satisfies it.

Symbolic operations obey the closed rules when their operands become known:

- `Pick R K` requires presence of every literal key. Once their field types are
  known, its result is closed even if `R` is open. A `Has` assumption supplies
  the corresponding field type without specifying the rest of `R`.
- `Omit R K` requires the same strict presence checks. A known prefix can be
  removed while retaining its tail, with lacks facts ensuring removed labels
  cannot reappear. A wholly unknown operand remains symbolic.
- `Merge A B` introduces `Disjoint A B`. Its result remains symbolic while
  either domain is unknown; it cannot be treated as an overwrite operation.

Unification may compare identical symbolic applications after substitution,
or reduce applications with known inputs. It must not invert a result equation
to invent operands. For example, `{ :name String } = Pick R [:name]` does not
determine `R`. Equal results of different computations need not imply equal
inputs. If equality cannot be established by these rules, require an annotation
or concrete inputs rather than running an unrestricted row-equation search.

Termination comes from decomposing finite prefixes, normalizing finite key
vectors, and retaining deduplicated unknown relations. No user-defined solver
rules, type-level recursion, or speculative backtracking are introduced.

## Hindley–Milner and modules

An explicit signature quantifies its variables rigidly during body checking.
Its predicates become assumptions; the body cannot specialize an unknown row
to a convenient shape or assume an undeclared absence. Infer obligations from
each operation and require them to follow from those assumptions.

For unannotated bindings, generalize the deterministic residual predicates
alongside the type, using the existing generalization boundaries. Do not widen
the existing treatment of effects or polymorphic values. A predicate referring
only to generalized variables may survive; a predicate with an otherwise
unconstrained variable that is absent from the exported type is ambiguous and
must be rejected. Predicates also referring to environment-bound variables stay
pending at the enclosing scope rather than being dropped or freshened as local
parameters. Unsolved monomorphic obligations are errors.

Both engines must carry row predicates and symbolic operation operands through:

1. Free-variable collection and substitution, including variables occurring
   only in predicates or computations.
2. Generalization, fresh instantiation, and occurs checks.
3. Annotated-body entailment and call-site obligation discharge.
4. Module export, import, aliasing, and re-export.

[RFC 0002](./0002-modules-and-packages.md) currently exports portable
`scheme: {parameters, type}` syntax. Extend that syntax to preserve an outer
`Where`, explicit parameter roles, and symbolic row expressions. Imported
schemes must receive fresh variables and obligations on every use. Older
consumers must reject unsupported scheme syntax; stripping `Where` is unsound.
Do not include inference-session variable IDs in the portable contract.

## Value operations and compatibility

Add `merge-disjoint` with exactly two structural record arguments. It uses
`Merge` and its disjointness obligation; dictionaries are outside this primitive.
Add `pick-record` and `omit-record` with literal keyword vectors and the strict
presence rules of their type operations. These primitives let generic bodies
produce the symbolic result types they declare.

Keep existing `merge`, `select-keys`, and `dissoc` semantics, including overwrite
and permissive missing-key behavior. A constrained signature alone must not
magically change those operations. Existing runtime representations can implement
the new primitives after static checking; the public contract must prohibit
collisions and missing keys. Host entry points that validate values must also
validate concrete structural shapes before invoking checked functions.

## Diagnostics and evidence

Keep author origins for predicates, operation operands, and argument sites.
Use proposed code `typecheck/row-constraint` for predicate failures, while
malformed operations retain `typecheck/row-operation`. At a failed instantiation,
the primary span is the conflicting argument/key; related information points
to the signature that required disjointness or absence. An annotated body with
insufficient assumptions points to the offending operation in that body.

Acceptance requires shared fixtures for closed success/failure, known prefixes
with unknown tails, collisions introduced by later substitution, contradictory
presence/absence, omitted-field reintroduction, ambiguous constraints, separate
instantiations of one function, and rejected inverse inference. Include positive
and negative imported/re-exported function cases. Pin exact author source IDs
and spans, and assert evaluation of the new primitives against explicit records.

Implement TypeScript, then OCaml; only claim parity after independent goldens
and `pnpm parity:engines` pass. A TS-only intermediate landing must list the
language difference explicitly. Package behavior changes require changesets.

## Delivery and exclusions

Land the predicate/scheme lifecycle and open-row uniqueness invariant first,
then symbolic operations and primitives, then portable module schemes. Do not
enable public generic signatures before obligations survive all supported
boundaries. A local-only prototype is not completion of this RFC.

Schema normalization is [RFC 0007](./0007-type-normalization.md); declaration
reflection and checked result templates are [RFC 0008](./0008-typed-form-results.md).
Computed keys and row mapping are [RFC 0009](./0009-field-names-and-row-map.md).
Higher-rank row constraints, subtyping search, arbitrary type-level functions,
row renaming, and dependent runtime field selection remain outside this design.
