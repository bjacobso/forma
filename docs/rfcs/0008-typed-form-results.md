# RFC 0008: Typed declaration reflection and form result templates

| | |
| --- | --- |
| Status | Proposed; not implemented in either engine |
| Created | 2026-10-09 |
| Depends on | [RFC 0007](./0007-type-normalization.md) for the bridge; [RFC 0006](./0006-qualified-rows.md) and [RFC 0009](./0009-field-names-and-row-map.md) for generic template checking |
| Scope | Metadata-to-type reflection, declarative form result types, and compatible prelude migration |

## Problem and outcome

Ontology `query` currently computes its result with an imperative result hook:

```lisp
:type (fn [{:keys [from select]}] (List (row-of from select)))
```

`from` names a declaration; it is not a record type. `select` captures optional
symbol syntax; it is not a literal keyword vector in a type annotation.
Replacing the hook with `(Pick from select)` would cross neither boundary and
would lose the absent/empty-selection behavior. HTTP forms likewise consume
schema-valued holes rather than only ordinary HM annotations.

The desired result is a prelude-defined, declarative result family that is checked
once against its input contracts. Applying a form still resolves the concrete
declaration and selection and discharges constraints. Checking once means checking
the template's validity for those contracts, not avoiding all work at a use site
or proving arbitrary existing hook bodies correct.

## A typed, domain-neutral reflection boundary

Let declaring forms opt into exporting record-field type information. Proposed
form option `:reflect` maps a declaration-name hole to a field-source hole:

```lisp
; Proposed addition to the existing entity form, not executable today.
:reflect {:name {:fields :fields}}
```

Here `:name` must be a `Declares` hole and `:fields` must have the checked
`(Record Type)` contract. Validate every field's type syntax, normalize its base
type through RFC 0007, and retain metadata/provenance separately. Reflection
must not run an arbitrary function to produce a trusted record shape. Other
domains can expose the same capability through their own declaring forms.

The declared capability becomes part of the declaration-kind contract. A result
template using a reference hole must be checked against that contract, including
whether the referenced kind provides field reflection. Producer forms must meet
it. A plain `Symbol`, an unresolved reference, or a reference of another kind
cannot be used as a reflected record. This extends today's `Declares`/`Refers`
checking; it is not a reinterpretation of their current symbol values.

Reflection follows resolved declaration identity, not a process-global string
lookup. For supported cross-file references, portable interfaces carry validated
field syntax/types and declaration identity with source origins. This complements
the declaration reference index described in [RFC 0002](./0002-modules-and-packages.md);
it must not conflate artifact declaration references with runtime module bindings.
If a loading path cannot preserve that evidence, reject reflection through it
until the interface is extended. No ontology, entity, endpoint, or query names
are added to the compiler.

## Restricted result templates

Add `:result` as an alternative to `:type`, and reject forms specifying both.
`:type` keeps its existing syntax and hook behavior. `:result` is parsed as a
checked template, not evaluated as a Lisp expression:

```lisp
; Proposed replacement for query's result hook.
:result (List (Pick (FieldsOf from) (SelectionKeys from select)))
```

The template language contains ordinary type constructors, record operations,
and a finite set of typed slot adapters:

| Adapter | Input contract | Type-level result |
| --- | --- | --- |
| `(FieldsOf reference-hole)` | Reference to a declaration with field reflection | That declaration's structural record type |
| `(TypeOf type-hole)` | Checked `Type` hole | Its type expression |
| `(SelectionKeys reference-hole selection-hole)` | Reflected declaration plus optional literal symbol/keyword vector | A key-set index selecting declared fields |

Slot identifiers refer only to holes of the containing form. No function calls,
arbitrary branching, recursion, datum-to-type casts, or access to unrelated
declarations are allowed. Literal templates remain possible. Concrete operands
normalize using the same reducer as signatures and schemas.

`SelectionKeys` deliberately supplies the compatibility policy needed by the
existing query: absence or an empty vector means all declared fields. A nonempty
selection converts author field symbols to the corresponding keyword labels
and validates them. It does not inject identity fields or unwrap `Option` field
types. Ordinary `(Pick R [])` still produces an empty record.

The existing `row-of` result map deduplicates repeated selected names. Preserve
that behavior in this adapter by canonicalizing its type-level keys while
retaining the original selection syntax for emitted IR. Do not silently rewrite
the `QueryIR` selection vector or impose the ordinary literal `Pick` duplicate
rule on legacy query inputs. A stricter domain selection policy would be a
separate prelude change.

Adapter results are trusted only after validating their captured syntax and
declaration contract. Arbitrary runtime vectors and strings cannot become type
indices. Retain a source span per captured field, including its pre-conversion
symbol span, rather than reconstructing blame from generated keywords.

## Checking a template once

During prelude analysis, bind reflected declaration fields to an abstract row
and the selection adapter to an abstract key-set index. Its validated adapter
contract supplies `Selects R K` from RFC 0009. Under that assumption, check
`Pick R K` as a well-formed result type using RFC 0006's scheme lifecycle.
Reject invalid slot references, unsupported capabilities, and unprovable
operation obligations in the prelude itself.

For example, a template merging an arbitrary reflected row with `{:id Int}`
is invalid unless the declaration contract explicitly guarantees absence of
`:id`. A finite successful expansion is not evidence for such a guarantee.
Initially field reflection supplies presence for validated selection, but no
arbitrary absence promise; adding a domain contract for absence requires its
own producer validation and fixtures.

At each form application, resolve the declared reference, reify its checked
fields, validate the literal selection, substitute those indices, and normalize
the result. These steps instantiate an already checked template; they do not
evaluate or recheck a general result-hook program. Validation of the form's
`:ir`, `:check`, and `:emit` bodies remains separate. This RFC does not certify
all metaprograms or prove an emitter preserves semantics.

## Prelude migration and compatibility

First add reflection and concrete normalization behind the existing `row-of`
API. That removes duplicated field-type processing but still computes a result
per application; do not advertise it as generic template checking.
Legacy `row-of` consumers without the new capability retain their existing
metadata lookup path. Only checked templates require the new reflected contract;
an opt-in capability must not silently invalidate older consumer preludes.

After RFCs 0006 and 0009 support template indices and obligations, add `:result`
and migrate ontology `query`. Compare against the old hook on a shared corpus:
all fields, absent selection, empty selection, repeated names, subset selection,
optional fields, aliases, type metadata, invalid names, and imported declarations
where the reference path is supported. Keep `row-of` as a compatibility wrapper
for consumers; do not deprecate or remove it in the same change.

Generated canonical/Effect artifacts must remain identical for existing source
programs, including selection order and domain-qualified emitted field names.
Result types must match existing `row-of` types; field metadata stays available
to other projections. Any discovered difference is a migration blocker or a
separately documented semantic change, not an incidental normalization detail.

HTTP can first use computed schemas in existing `Type` holes through RFC 0007.
Change its prelude declarations only where a repeated field contract can actually
be expressed with a checked type operation. The current schema/IR-building hooks
do not all become result templates merely because this feature exists. Endpoint
handler linking must still validate success, request, and error contracts.

## Diagnostics, acceptance, and stages

Use proposed `form/invalid-result-template` for a bad template or undeclared
capability at the prelude's offending node. An unknown selected field points
to that symbol in the author's form, with related information for the reflected
declaration. Missing/inaccessible references retain existing resolution errors.
Normalization failures preserve operation origins through template instantiation.

Acceptance requires shared fixtures for two unrelated reflected declaration
kinds, invalid reflection producers, prelude-level rejected generic templates,
per-use selection failures, declaration identity across supported imports, and
source spans after adapter conversion. Run old and new ontology implementations
against independent expected types and artifact goldens in both engines.
TypeScript-only editor support may land separately, with slot completions based
on reflected fields and invalidation after declaration edits.

| Stage | Dependency | Completion evidence |
| --- | --- | --- |
| Validated reflection and `row-of` compatibility bridge | RFC 0007 | Existing result/artifact goldens unchanged in both engines |
| Checked result templates and typed slot adapters | RFCs 0006 and 0009 | Valid generic templates accepted; unsound templates rejected before application |
| Ontology migration and useful HTTP schema reuse | Previous stages | Old/new corpus equivalence, full checks and engine parity |

No arbitrary dependent types, runtime schema introspection in signatures,
unchecked meta-hook promotion, or removal of legacy hooks is included. Public
reflection/template contracts and changed engine behavior need changesets and
documentation that records implemented support separately from remaining stages.
