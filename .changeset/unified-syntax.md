---
"@formalang/ts": minor
"@formalang/editor": patch
---

**Breaking:** Replace the previous authoring grammars with one canonical syntax
for types, declarations, patterns, Effects, and forms (RFC 0001). Older source
must be rewritten; no compatibility layer or automated migration is provided.
`type` replaces `define-type` and `define-schema`, with records written
`{:field T}`, `(Union :a :b)`, `(Tagged ...)`, and `(Option T)` for optional
fields. Types use canonical names such as `String`, `Bool`, `Unit`, `List`, and
`(Map String V)`; lowercase aliases and the `{a b}` set literal are removed.
`error`, `class`, `service`, `layer`, `macro`, and `form` replace their
`define-` forms, `(Effect A)` replaces `(Effect A [] [])`, `do!` binds with
`[x e]` and `:let` instead of `<-`, and `Some`, `None`, `Ok`, and `Err` replace
`some`, `none`, `success`, and `failure`. Ontology declarations use `entity`,
`seed`, `attribute`, `query`, and `workspace`. Typed `form` definitions derive
validation, bindings, projections, artifact contracts, completion, and
formatting. Canonical artifact payloads change shape, and tagged wire values use
the constructor name. `bootstrapFromFiles` moves from `@formalang/ts/descriptor`
to the Node-only `@formalang/ts/node` entry point so browser entry points do not
import the filesystem.
