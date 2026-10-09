# RFC 0007: Shared type normalization for record consumers

| | |
| --- | --- |
| Status | Proposed; not implemented in either engine |
| Created | 2026-10-09 |
| Depends on | [RFC 0005](./0005-row-operations.md); [RFC 0006](./0006-qualified-rows.md) for symbolic inputs |
| Scope | Contextual coercion, type values, schema emission, and tagged payload classification |

## Problem and outcome

RFC 0005 reduces operations in the HM checker. Other consumers still inspect
type syntax: contextual Option coercion follows explicit record syntax, form
hooks produce type data, and Effect projections build schemas. A computed record
can therefore check as a record without receiving the behavior of the equivalent
literal annotation. Adding independent `Pick` implementations to each consumer
would create conflicting semantics and diagnostics.

This proposal gives each engine one semantic normalization service that these
consumers share. The two engines need the same contract and fixtures, not shared
source code. Existing literal and alias programs must keep their behavior and
generated artifacts. This is proposed integration, not a claim that computed
schemas or contextual coercion ship today.

## Normalization contract

Separate syntax parsing, semantic resolution, and consumer projection:

```text
authored type syntax + lexical/module type environment + row assumptions
  -> checked type expression
  -> normalized type view, or residual computation and obligations
  -> consumer-specific schema/value/code projection
```

The normalized view exposes scalar/application/record/function/nominal shapes,
field types, open tails, and any residual symbolic computations. Preserve nominal
identity rather than treating brands, classes, errors, or schema references as
structural rows. Operation evaluation uses RFC 0005/0006 rules; consumers cannot
add an alternate interpretation of missing fields or overlap.

Keep provenance beside semantic identity. A selected field retains its original
declaration span and the selecting operation's span; an instantiated alias also
retains the use-site span. Cache keys include the type environment revision,
parameter substitution, and relevant assumptions. Cached semantic results must
not reuse another caller's diagnostic location.

Two modes use the same reducer:

| Mode | Allowed result | Intended consumers |
| --- | --- | --- |
| Symbolic | Generalized variables, residual computations, retained obligations | HM schemes, generic body checks, hover |
| Concrete | Resolved shape and no unresolved obligations; supported field types for the target | Runtime validators, Effect schemas, artifact emission |

A closed record shape may still have polymorphic field types. That is sufficient
for HM but does not guarantee a concrete target schema. Target representability
is a separate check after normalization. An emitter cannot turn an unresolved
operation into `Unknown`, omit its fields, or defer its proof to runtime.

For a finite map, retain deterministic field ordering for each existing output
contract. Do not make semantic equality depend on order. Where a consumer already
uses author order, preserve it through projection/removal and concatenate disjoint
merge operands in that order; use existing canonical sorting for canonical IR.
Golden artifacts decide compatibility, not a new global sorting policy.

## Contextual Option coercion

Use the normalized expected shape in the existing contextual rules. For example:

```lisp
; Proposed: omitted computed Option fields are not filled today.
(type Contact {:name String :email (Option String)})
(type PublicContact (Pick Contact [:name :email]))
(: contact PublicContact)
(define contact {:name "Ada"})
```

The last value should elaborate exactly as it would under the equivalent literal
record annotation, including insertion of `None`. Existing `Some`/`None` values
stay unchanged; an eligible raw field value receives the same wrapping as with
literal syntax. Preserve the current contextual boundaries rather than adding
coercion in arbitrary inferred expressions.

Do not invent missing fields of an unknown tail. Coercion is permitted only for
fields whose expected type is known after normalization. If producing a value
requires resolving a symbolic record domain, report that requirement at the
annotation instead of guessing. Elaborated nodes carry the author's value span
and the expected field's origin so later failures remain attributable.

Moving coercion behind semantic resolution must avoid a cycle: syntax resolution
and type normalization cannot depend on coercion of the value being checked.
Normalize an available expected type, elaborate contextual conversions, then
check the result. Reuse a checked expected view rather than reinferring the whole
program for each field.

## Type values and Effect schemas

A `Type` hole may contain a computed record expression once it passes the same
parser/resolver. Keep domain metadata, such as validation rules and documentation,
associated with fields in a separate view; normalizing their base types must not
erase that metadata from an artifact that currently preserves it.

`ts/schema`, schema validation, and Effect declaration/HTTP projections consume
the concrete view. Equivalent literal, alias, and computed shapes must emit
identical schemas under the existing ordering contract. For example, an endpoint
success type may use `(Pick Person [:name])` after this RFC; its generated schema
must match the corresponding explicit `{:name String}` success type.

Do not force every artifact to store an engine's internal normalized type graph.
Project into its existing portable representation. If an artifact intentionally
stores author syntax, keep that field and add an explicitly versioned normalized
view only when the consumer needs it. Module schemes may retain computations
under RFC 0006, while concrete runtime/schema artifacts cannot.

This work fits [RFC 0004](./0004-one-analysis-architecture.md): consumers should
reuse analysis results and source origins. It need not wait for the proposed
union-find checker or wholesale IR rewrite, and must not introduce another
checker alongside them.

## Tagged payloads and representation compatibility

Today `Tagged` flattens inline literal record payloads beside the discriminator,
but alias/computed payload syntax follows the existing `:value` path. Automatically
classifying aliases by normalized shape would change constructor values and wire
formats. Normalization alone must not make that change.

Propose an extended tagged arm `(Constructor Payload :payload :inline)` to opt
into flattening a normalized structural record. This is new arm syntax, not
metadata accepted by the current parser; its parser and fixture contract must
be reviewed before implementation. Unmarked aliases and computed payloads retain
their existing representation; literal record payloads keep their current default.

For an opted-in payload, require `Lacks Payload discriminator`, using `:_tag`
or the custom `:tag` field. A known collision fails even if its type equals the
discriminator type. An open generic payload requires a retained proof from
RFC 0006; concrete schema emission still requires a resolved finite shape.
Generated generic constructor schemes must expose this obligation in their
outer `Where`, including through module export and import.
Do not flatten nominal records implicitly. Reserved error discriminators must
receive equivalent collision checking through their existing representation.

This additive opt-in is preferable to silently changing aliases, but it needs
constructor evaluation, pattern matching, schema emission, and decoding fixtures.
Changing the default later would require a separate migration decision and
changeset; it is not authorized by this RFC.

## Diagnostics and acceptance

Reduction failures keep `typecheck/row-operation` or the qualified-row diagnostic
from RFC 0006. Unsupported concrete target shapes use the target's existing
representability diagnostic, pointing to the unresolved operand or unsupported
field. Tagged flattening collisions point to the payload field/operation with
related information identifying the discriminator declaration.

Acceptance requires:

- Literal/alias/computed record annotations producing the same checked values
  and Option coercions, including negative field errors with exact author spans.
- Normalized `Type` holes, validators, and Effect/HTTP schema projections with
  independent expected artifacts for both engines.
- Unknown tails and polymorphic target fields rejected at concrete emission
  boundaries, without `Unknown` fallbacks.
- Tagged literal defaults unchanged, alias/computed defaults unchanged, opted-in
  flattening checked across constructors, matching, emitted schemas, and decoding.
- Cache reuse after edits or alias changes without stale fields or source spans.

Land closed-shape normalization consumers first, then contextual coercion and
schema/type-value support, then opt-in tagged flattening. Symbolic payload support
waits for RFC 0006. Run the normal package checks, native tests and engine parity;
also build/typecheck generated Effect output and compare existing artifact
goldens. Language-service consumers are TypeScript-only under RFC 0004; shared
language/schema behavior requires checked engine parity.

No ontology-specific field lookup, arbitrary runtime-to-type conversion, new
subtyping rules, or automatic changes to tagged wire representations are included.
