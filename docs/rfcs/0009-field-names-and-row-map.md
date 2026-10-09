# RFC 0009: Bounded field names, key sets, and row mapping

| | |
| --- | --- |
| Status | Proposed; not implemented in either engine |
| Created | 2026-10-09 |
| Depends on | [RFC 0006](./0006-qualified-rows.md); [RFC 0007](./0007-type-normalization.md) for concrete consumers |
| Scope | Compile-time field/key indices and mapping named unary type constructors over records |

## Problem and outcome

Literal key vectors cover fixed projections, but a generic projection library or
form result template needs to refer to a checked selection without enumerating
it in its own signature. Libraries also duplicate record shapes when replacing
each field type with `Option T`, `List T`, or another uniform wrapper.

Ur provides field-name computation and record mapping as part of a much richer
type-constructor language. This proposal adopts two bounded pieces: finite
field/key indices and mapping a named unary constructor. It does not adopt a
type-level lambda calculus. The prior-art references are in
[RFC 0005](./0005-row-operations.md).

## Separate index roles

Introduce compiler-tracked roles for `FieldName` and `KeySet`, distinct from
ordinary value types and record row variables. A keyword in a field-name
position is a literal field index; a vector of distinct keyword indices in a
key-set position is a finite set. Existing keyword literal *value types* retain
their current meaning outside index positions.

Parameters acquire roles from their declared use in signatures/aliases; reject
inconsistent uses. Export the roles explicitly in portable schemes, and freshen
them at instantiation alongside RFC 0006's row and type parameters. There is no
general user-defined kind system in this proposal.

Extend the existing operations to accept key-set parameters, and add:

| Expression/predicate | Meaning |
| --- | --- |
| `(Keys R)` | The domain of structural record `R` as a key-set index |
| `(Selects R K)` | Every key in `K` is present in `R` |
| `(Has R label T)` / `(Lacks R label)` | RFC 0006 predicates, now also accepting a field-name parameter |
| `(MapFields F R)` | Preserve `R`'s labels and replace each field type `T` with `F T` |

`Pick R K` and `Omit R K` require `Selects R K`, preserving strict missing-key
behavior. For a literal vector this reduces to RFC 0006's finite presence
obligations. For an abstract key set, retain the relation; do not enumerate an
unknown set or invent field types. Empty selection is valid. `Keys R` normalizes
only when `R`'s domain is known, otherwise it stays symbolic.

Field-name parameters initially support selection, presence, and absence, not
variable labels inside authored record literals. This avoids adding computed
record construction and label equality solving in the first implementation.

## Value witnesses and phase separation

Provide `KeyWitness K` and `FieldWitness label` as value types tied to checked
compile-time indices. Literal keyword vectors/keywords can receive these types
in a witness context. A key witness retains a deterministic iteration order for
runtime projection; type equality of its key-set index is order-independent.
Duplicate literal entries remain an error before set canonicalization.

Extend the new `pick-record`/`omit-record` primitives from RFC 0006 to consume
key witnesses. A proposed generic library signature is:

```lisp
; Proposed: key-index parameters and witnesses do not exist today.
(: project
  (Where [(Selects {& row} keys)]
    (-> {& row} (KeyWitness keys) (Pick {& row} keys))))
(define project [record selection] (pick-record record selection))
```

Add `get-field` for a record and a `FieldWitness`, requiring `Has R label T`
and returning `T`. It lets a generic field accessor use an abstract field name
without guessing its spelling or modifying the existing dynamic `get` operation:

```lisp
; Proposed: the field name is checked through its witness.
(: field
  (Where [(Has {& row} label a)]
    (-> {& row} (FieldWitness label) a)))
(define field [record label] (get-field record label))
```

A plain `(List Keyword)` is not a witness. Concatenating arbitrary vectors,
reading a file, or accepting unchecked host data cannot manufacture an index.
Dynamic dictionary operations remain the route for runtime-selected keys.
Witness representations may reuse existing immutable keyword/vector values,
but constructing one requires the static evidence, and host decoders must enforce
the concrete index. This is a phase boundary, not a general singleton-type system.

The typed slot adapters in [RFC 0008](./0008-typed-form-results.md) can produce
indices from validated author syntax without runtime witnesses. Their explicit
legacy-query deduplication policy is confined to that adapter; it does not relax
the rule for ordinary witness literals or `Pick` key vectors.

## Restricted mapping

```lisp
; Proposed: MapFields does not exist today.
(type Person {:name String :age Int})
(type OptionalPerson (MapFields Option Person))
(type BatchedPerson (MapFields List Person))
(type (Wrapped a) {:value a})
(type WrappedPerson (MapFields Wrapped Person))
```

`F` must resolve to a named constructor or transparent alias with exactly one
type parameter. It is fixed by the program, not quantified over or supplied as
a type-level function value. Reject partially applied multi-argument constructors,
arrows used as constructors, type-level lambdas, recursive aliases, and aliases
requiring hidden row constraints. Existing nominal unary constructors retain
their identity when applied to a field type.

The rule for a finite row is:

```text
F is a supported named unary constructor
----------------------------------------------------
MapFields F { l1:T1, ..., ln:Tn }
  ⇓ { l1:(F T1), ..., ln:(F Tn) }
```

For an open row, normalize its visible fields and retain `MapFields F tail`
symbolically. Mapping preserves the domain: the solver may transport presence,
absence, selection, and disjointness facts using that identity. Typed presence
transforms from `Has R l T` to `Has (MapFields F R) l (F T)` in the forward
direction only. Do not invert `F T` to guess `T` or infer a source row from its
mapped result. A mapped tail must satisfy the same unique-label invariant as
its source.

Mapping is type computation only; it does not map runtime field values. A future
generic value traversal would need its own checked term primitive and evaluation
contract. Existing Option contextual coercion can consume a concrete mapped
expected type under RFC 0007 without becoming such a traversal primitive.

## Predictable inference and boundaries

Use the finite constraint worklist of RFC 0006. Concrete key sets reduce to
literal membership checks; unknown ones retain `Selects`. Identical symbolic
expressions compare after substitution. Domain preservation for `MapFields` is
a built-in rule, not a general theorem prover. Do not solve arbitrary key-set
union/difference equations, infer a constructor from mapped fields, or search
for label assignments.

Unsolved monomorphic indices and relations fail at the existing checking boundary.
Generalized indices must occur in the public type, including its symbolic
expressions or witness arguments; predicate-only indices are ambiguous. Concrete
schema/artifact emission requires a known finite domain and supported field types.
Generic module schemes retain indices, constructor identity, and obligations.

Type-level reduction remains structural and finite. Alias cycles use explicit
cycle diagnostics; user recursion and rewrite rules are disallowed. Set equality
uses canonical finite labels, while output ordering follows RFC 0007's consumer
contract. Computed keys cannot alter runtime evaluation order implicitly.

## Diagnostics, delivery, and acceptance

Use proposed `typecheck/row-index` for wrong index roles, nonliteral witness
construction, duplicate witness labels, or unresolved monomorphic indices.
Point to the supplied index/witness syntax. Invalid mapping constructors point
to `F`; missing selected keys preserve the author key span; failed generic
obligations use RFC 0006's call-site and related signature origins.

Land key-set indices, `Selects`, and scheme serialization first: these unlock
RFC 0008's checked selection templates. Add field-name parameters/witnesses
next, then closed `MapFields`, then its symbolic domain-preservation rules.
Do not make ontology migration depend on the optional mapping stage.

Acceptance requires shared positive/negative fixtures for literal and abstract
selection, known/open domains, duplicate keys, role confusion, fresh polymorphic
instantiation, imported schemes, dynamic vectors rejected as witnesses, and
host witness validation. Include generic field-access evaluation and missing-field
failures with witnesses. Mapping fixtures cover empty/nested records, unchanged
labels, retained field polymorphism, unary aliases, unsupported constructors,
alias cycles, open-tail collisions after substitution, and rejected inverse
inference. Concrete mapped schemas need independent Effect artifact goldens
and generated-output typechecking in both engines.

Record TypeScript and OCaml implementation status per stage; engine parity is
a test result, not implied by accepting this RFC. Run package checks, native
tests, and engine parity for each shared language stage, with changesets for
behavior changes. General row renaming, arbitrary key-set algebra, higher-kinded
constructor parameters, term-level record folds, type-level lambdas, and dependent
runtime computation remain outside the rollout.
