# RFC 0021: Form-local extension metadata and named maps

| | |
| --- | --- |
| Status | Implemented |
| Created | 2026-11-04 |
| Scope | Constant descriptor extensions and a prelude macro for maps keyed by binding names |
| Related | [RFC 0008](./0008-typed-form-results.md), whose checked result templates remain proposed |

## Problem and outcome

UI and ViewSpec forms repeat each component in a quoted `name.metadata`
definition, a typed `form`, and a property map spelling every binding twice.
The `.metadata` name itself has no meaning: `surface/metadata.ts` reads
`:descriptor-name` inside the value and `parsePrelude` merges the two descriptors.
Moving a form can therefore leave its extension metadata behind.

Let a form carry its own constant, domain-neutral extension data:

```lisp
(form (rows {:keys [gap visible]} child ...)
  "Builds a rows container with optional gap and visibility."
  :extensions
    {:view/component
      {:allows-bind false
       :compile {:expr-props ["visible"] :required-children true}
       :children "any"}}
  :types {:gap (Option Float) :visible (Option (Expr Bool))
          :child (List component)}
  :ir ComponentIR
  (component "rows" (named-map gap visible) child))
```

The compiler does not recognize component names, property conventions, or
`:view/component`. Existing consumers interpret those namespaces. Forms in
unrelated domains use the same option.

## Extension contract

`:extensions` must be a literal map. Its values may recursively contain
strings, numbers, Booleans, `nil`, keyword constants, vectors, and literal maps.
Map keys are strings or keywords; keyword names lose their leading colon in
the descriptor's JSON representation. Keywords used as values also become
strings. `nil` becomes JSON null. Duplicate normalized keys are rejected.
Symbols other than keywords and nil, calls, quoted expressions, and other
executable syntax are rejected at the offending source location. Configuration
is parsed, never evaluated.

Merge extensions derived from the IR contract with explicitly authored
extensions, with the explicit value winning for a shared top-level namespace.
This is a shallow namespace merge; a namespace's owner defines its record shape.
Metadata does not alter hole binding, result type checking, body evaluation, or
IR contract validation. Documentation examples and extension data retain authored names outside module
name resolution and do not pull executable helpers into a form's reachable closure.

Duplicate `:extensions` options follow the existing duplicate form-option rule.
An exported/imported form retains its extensions through ordinary descriptor
and form-source serialization; no separate `.metadata` export is needed.

## Migration and compatibility

Repository search found 68 `:descriptor-name` definitions, all belonging to
UI and ViewSpec components. Migrate all of them in this change. Keep ordinary
constant metadata definitions for layout aliases, registries, and protocol
configuration: they describe standalone metadata rather than a form.

The TypeScript package exposes descriptor bootstrap APIs. Repository search
cannot rule out external consumers of the old constant-definition convention,
so retain `:descriptor-name` as a deprecated compatibility path. No bundled
component uses it after migration. New form documentation teaches only
`:extensions`; removal of the compatibility path would require a separate
breaking change. Standalone metadata keeps its older map-key coercion and
last-value-wins behavior; direct form maps use the strict constant contract above.
Old and new extensions retain the same merge ordering when
the old metadata definition precedes its form.

## Named property maps without a compiler feature

Add `(named-map binding ...)` as a macro in `compiler.lisp`, available to all
domain projections. It expands to a map with literal string keys and the named
bindings as values:

```lisp
(named-map gap visible)
; expands to {"gap" gap "visible" visible}
```

The macro uses existing `reduce`, `assoc`, and `sexpr-sym-name` operations. It
accepts distinct identifier symbols, preserves their authored spelling and
order, and rejects duplicates, keyword names, and non-symbol arguments during
expansion. No arguments means an empty map. Each value is the original binding
syntax, so its location and lexical reference survive expansion. Nil-valued
bindings remain entries, matching the old explicit maps. It does not enumerate
all holes implicitly or exclude a special child slot: the author chooses which
bindings belong in the map.

This macro is a descriptor-prelude helper, not a new core form or a promise of
support in the separate Effect mechanics dialect. File-module libraries can
export/import such a macro explicitly. The kernel macro library is unchanged.

## Why literal IR kinds stay explicit

[RFC 0008](./0008-typed-form-results.md) proposes checked result templates and
reflection, not automatic record construction. It is not implemented. Today's
`:ir` validates a projected value; it does not inject literal fields into it.
Some projections select a union member dynamically, such as entity's Entity
versus MetaEntity kind. Removing the body discriminant would require a new
construction contract, decisions about singleton fields and unions, and changes
to evaluator and portable form behavior. Keep both the contract's literal kind
and the body's explicit kind. This change does not implement a partial version
of the proposed result-template system.

## Acceptance and checks

Conformance fixtures pin two unrelated extension namespaces, recursive constant
conversion, rejection with source locations, and projected IR. Tests cover the
compatibility path, IR-derived metadata merging, helper reachability, empty and
invalid named maps, lexical shadowing, and imported form metadata. Migrated UI
and ViewSpec forms retain their extension records and their component IR.
Existing surface, artifact, hosted protocol, and emitted TypeScript goldens must
stay unchanged. Run the complete checks and the assembled-site tests because
the generated reference also shows the new source representation.
