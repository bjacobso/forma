# RFC 0021: Printing IR back to source

| | |
| --- | --- |
| Status | Proposed; not implemented |
| Created | 2026-11-04 |
| Scope | Inverting form projections, printing declarations from canonical IR, source maps from IR pointers to printed spans, a round-trip conformance gate, a `:print` hook for forms that cannot be inverted |
| Direction | Derive the inverse from each form's pattern and projection where the projection is plain data; require an explicit, checked inverse where it is not |

## Summary

Forma elaborates source into canonical IR and can print source losslessly
from source. It cannot print source from IR. This RFC adds that direction:

```text
printDeclaration(ir, context) → { source, map: [{ span, pointer, refs }] }
```

`pointer` is the RFC 6901 JSON pointer of the IR fragment a printed span
shows, and `refs` are the declaration identities it references. For most
forms the printer is derived from the form definition itself: its pattern
says where each hole is written, and its projection says which IR field each
hole becomes. A form whose projection computes values must supply a `:print`
hook. A conformance gate checks that every printable declaration in the
corpus elaborates back to byte-identical canonical IR.

## Motivation

onb-next authors packages in a TypeScript DSL that emits JSON IR. It also has
a printer from IR back to DSL source (`packages/dsl/src/print/`), used in
two places:

- **Beside a graph.** `printDefinition(doc, ctx)` returns lines
  `{ depth, text, pointer, refs }`. The web app shows the DSL next to a
  graph of the same definition. Selecting a node lights up the lines whose
  pointer or refs include it (`packages/web/app/lib/graph/dsl.ts`,
  `selection.ts`).
- **As an exit test.** `demo/acme/test/print.test.ts` prints every package,
  compiles the output with `tsc`, imports it, and compares the rebuilt
  package content with the original.

Three details of that implementation shape this proposal:

- **The round trip compares by deep equality after a JSON round trip, not by
  bytes.** Key order and snapshot bytes are not compared.
- **The printer is hand-written per IR kind**: about 2,500 lines in
  `packages/dsl/src/print/`, with a module per kind and a shared layout
  engine. It needs context the IR lacks: a task's signer, choice
  labels, which names another package exports. Where it cannot print a
  shape, it falls back to an IR literal.
- **Some spellings are chosen by the printer:** hoisting gated fields into
  named constants, omitting default options, sorting keys.

A Forma consumer would need the same thing: a graph or form editor that
writes IR, a migration that rewrites declarations, an import from another
system. In Forma, the form definition already relates syntax to IR, so most
of that printer can be derived rather than written.

## Current state

- **Source to IR.** A form's pattern binds holes; its projection builds the
  IR value ([Writing a form](../writing-a-form.md)). Hole contracts say how
  each hole was elaborated: `Declares` and `Refers` holes become symbols,
  `Type` holes become type data, and `(List child)` holes become the
  children's IR. An `(Expr T)` hole's encoding depends on the IR field it
  lands in. In a `RuntimeExpr` field it becomes a `raw-expr` value with
  string-literal markers (`descriptor/runtime-expr.ts`). In a `Json` field,
  as in the `ui` forms' `:props`, it is emitted as bare data, so
  `(str "a" 1)` becomes `["str","a",1]` and the string `"a"` cannot be told
  apart from a symbol `a`. An absent option in such a field becomes `null`
  rather than an absent key.
- **Source to source.** The lossless reader and `formatSExpr`
  (`Formatter.ts`) print syntax trees. The outline codec prints an outline
  back to source with the original as a base
  ([Language services](../language-services.md)).
- **A projection evaluator for plain records already exists.**
  `projectBuilderIR` in `descriptor/form-emitter.ts` evaluates a projection
  symbolically for `generateFormBuilders`:

  ```ts
  if (e._tag === "Sym" && bindings.has(e.name)) return bindings.get(e.name)!;
  if (e._tag === "Map") return new Map(e.pairs.map(([k, v]) => [name(k)!, project(v)]));
  ...
  throw new Error(`Builder projection for ${descriptor.name} only supports records, literal values, and hole references`);
  ```

  This is the same class of projection that can be inverted.
- **Provenance.** Artifacts record each declaration's source and span
  (`declarationProvenance` in `artifact/artifact.ts`). Nothing maps IR
  fragments to spans.

A probe at commit `a62797e` classified each shipped form's projection, using
`bootstrapFromSources` on each prelude:

| Prelude | Plain record of literals and holes | Through one record-building helper | Computed |
| --- | --- | --- | --- |
| `elm.lisp` | 5 | | |
| `email.lisp` | 1 | | |
| `http-api.lisp` | 5 | | |
| `ontology.lisp` | 17 | | 37 |
| `ui.lisp` | | 62 | |
| `viewspec.lisp` | | 6 | |

The `ui` and `viewspec` forms all project through
`(component "text" {...} child)`, a helper whose body is itself a plain
record. Their shape is invertible, but their expression holes land in a
`Json` field, which loses the string/symbol distinction. They become
printable once those fields are typed `RuntimeExpr`, a prelude change that
does not alter the hole syntax. The 37 computed ontology forms call
helpers such as `fields->ir`, branch on an option
(`:kind (if (= tier :meta) "MetaEntity" "Entity")`), or rewrite names
(`(keyword from field)`).

## Proposal

### Deriving the inverse

A projection is **invertible** when, after inlining transparent helpers, it
is built only from:

- literals;
- references to holes, each used at most once;
- maps and vectors of the above.

A **transparent helper** is a top-level function whose body is itself
invertible in its parameters. `component` in `ui.lisp` is one. The prelude
metacheck classifies each form once and records the result in its
descriptor.

For an invertible form, the printer matches the IR against the projection:

1. Each literal field must equal the IR value. Literal fields, such as
   `:kind "Greeting"`, select which form printed the value. If two forms
   could have produced the same IR, the metacheck reports
   `form/print-ambiguous`.
2. Each hole reference binds that hole to the IR value at its pointer.
3. Each hole value is turned back into syntax by its hole contract and the
   type of the IR field it landed in:

   | Hole contract | IR value | Printed syntax |
   | --- | --- | --- |
   | `String`, `Int`, `Float`, `Bool`, enum alias | literal | the literal; the numeric kind comes from the hole's declared type, because plain JSON writes `1.0` as `1` |
   | `(Declares T)`, `(Refers T)` | symbol | the name, qualified through the module's imports |
   | `(Expr T)` in a `RuntimeExpr` field | `raw-expr` | the expression, with string-literal markers turned back into strings |
   | `(Expr T)` in a `Json` field | bare data | not invertible; the form must type the field `RuntimeExpr` |
   | `Type`, `(Record Type)` | type data | type syntax |
   | `Syntax` | datum | the datum |
   | `(List child)` | list of child IR | each child printed by the same procedure |
   | `(Option T)` | absent field, or `null` in a `Json` field | the option omitted |

4. The printer rebuilds the application from the pattern: positional holes
   in order, the optional docstring, options in pattern order, then children.
   `formatSExpr` lays it out.

A hole that the projection does not use cannot be recovered, so a form with
an unused hole is not invertible. `__action` in `ontology.lisp` has six.

### Forms that cannot be inverted

A computed projection needs an explicit inverse. The form supplies
`:print`, a pure function from the IR value to a record of hole values:

```lisp
(form (entity name fields {:keys [doc role id-pattern tier]})
  ...
  :print (fn [ir]
    {:name (get ir :name)
     :fields (fields-from-ir (get ir :fields))
     :doc (get ir :doc)
     :role (get ir :role)
     :id-pattern (get ir :idPattern)
     :tier (if (= (get ir :kind) "MetaEntity") :meta nil)})
  {:kind (if (= tier :meta) "MetaEntity" "Entity") ...})
```

The engine never trusts a `:print` hook. The round-trip gate below runs
`project(print(ir))` over the form's fixtures and reports
`form/print-mismatch` with the first differing pointer.

An author whose projection cannot be inverted has three choices:

1. **Make it plain.** Move computation out of the projection, for example
   into a typed child form, or keep the authored value in the IR next to
   the derived one.
2. **Write `:print`.** Appropriate when the computation is a bijection, such
   as qualifying field names with their owner.
3. **Accept that the form does not print.** The printer reports
   `print/not-invertible` with the pointer. A host shows the IR instead, as
   onb-next does for shapes its printer does not support.

Some projections are many-to-one. `query` writes `(or select [])`, so an
absent selection and an empty one both become `[]`. The inverse picks one
canonical spelling (here, absent). The gate compares IR, so this is allowed.
Printed source is canonical, not a reproduction of the original text.

### Source maps

The printer tags each syntax node it builds with the pointer of the IR value
it came from and the declaration identities that value references. After
`formatSExpr` lays out the text, the printer reparses it with the lossless
reader and walks the new tree alongside the tagged one. The two trees have
the same shape, so each tag gets a span. The formatter needs no changes.

The result maps spans, not lines. A host can derive onb-next's line view
from it: for each line, use the innermost span that covers the whole line,
and collect the refs of the spans inside it.

### Context the IR does not carry

- **Imports.** A `Refers` value is a declaration identity. The printer takes
  the target module's imports, or its interface, and prints the local name.
  If no import brings the name into scope, it returns the import it needs in
  `requiredImports` instead of inventing one.
- **Comments and helper names** are not in the IR and are not recovered.
- **Editing existing source.** When the original source is available, a host
  prints only the changed declarations and replaces them with an edit script
  ([Language services](../language-services.md)). Comments and layout of
  unchanged declarations stay as they were. onb-next regenerates whole
  modules.

### Host operation

`printDeclarations({ sessionId, declarations, module? })` returns
`{ source, map, requiredImports, diagnostics }`. The library function
`printDeclaration` in `@formalang/ts` is UI-free and can run in the browser,
as onb-next's printer does.

## Alternatives considered

- **Hand-written printers per prelude.** This is onb-next's approach. It
  duplicates every form definition and drifts from it. Deriving the
  inverse keeps one source of truth, with `:print` as the exception.
- **Store authored source in the IR.** Printing would become trivial, but
  canonical IR would then change with formatting. That contradicts
  [RFC 0024](./0024-declaration-and-package-identity.md), and a declaration
  built by a tool has no authored source to store.
- **A bidirectional projection language (lenses).** It would make every
  projection invertible by construction. It also restricts projections more
  than the existing preludes accept. Ordinary functions plus a checked
  `:print` are enough for the computed ontology forms.

## Conformance

- **Round trip.** For every declaration from an invertible or
  `:print`-bearing form in `examples/`, `conformance/` and the prelude
  reference examples, `canonicalJson(elaborate(print(ir)))` must equal
  `canonicalJson(ir)` byte for byte. This compares canonical bytes, which is
  stronger than onb-next's deep equality.
- **Idempotence.** `print(elaborate(print(ir)))` equals `print(ir)`.
- **Maps.** Fixtures pin the spans for a nested child and a `Refers` hole,
  and check that every pointer in the map resolves in the IR.
- **Diagnostics.** Fixtures pin `form/print-ambiguous`,
  `form/print-mismatch` and `print/not-invertible` at the prelude or IR
  location that causes them.
- **Classification.** A stored golden lists each shipped form's class
  (invertible, `:print`, not printable). A change to a prelude that changes
  a class shows up in review.

## Implementation stages and validation

1. **Plain projections.** Classification, matching, hole un-elaboration and
   pattern rebuilding. The round-trip gate runs over the 28 plain forms in
   `elm`, `email`, `http-api` and `ontology`.
2. **Transparent helpers.** Inlining, plus typing the `ui` and `viewspec`
   expression fields as `RuntimeExpr`. Together they cover the 68 forms
   that use `component`.
3. **`:print`.** The hook, its check, and migration of `entity` and
   `relation` as worked examples.
4. **Source maps and the host operation.** Tagging, reparse alignment, and
   `printDeclarations`.
5. **Editing existing source.** Printing changed declarations into edit
   scripts.

## Decisions still required

- Whether `:print` returns hole values (proposed) or source syntax.
  Hole values keep pattern layout in the engine; syntax gives an author
  full control.
- How much of the corpus must be printable before the gate is required in
  `pnpm check`. The proposal is all plain, `ui` and `viewspec` forms at
  stage 2.
- How far to go with `raw-expr`. Stages 1 and 2 must print it, because
  [RFC 0020](./0020-portable-expression-core.md) keeps `raw-expr` for
  non-portable holes and nearly every `ui` form has one. `raw-expr` does not
  record which names are operators and which are scope bindings, so the
  printer copies names as written and cannot requalify them for another
  module. Portable expressions from RFC 0020 can be requalified.
- Whether ambiguity between forms is an error, or resolved by declaration
  order.
