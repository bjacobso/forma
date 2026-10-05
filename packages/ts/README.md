# `@formalang/ts`

The TypeScript implementation of Forma. It provides the lossless reader,
formatter, macro expander, evaluator, bytecode VM, Hindley–Milner inference,
editor analysis, elaboration protocols, and artifact generation.

```ts
import { Evaluator, Reader, Type } from "@formalang/ts";
import { parseManyToSExpr } from "@formalang/ts/reader";
import { inferSourceStr } from "@formalang/ts/type";
```

The package is runtime-neutral. Domain forms and target-specific behavior are
registered by consumers through descriptors, preludes, and host services.

## Bundled preludes

The repository's Lisp preludes ship as strings from `@formalang/ts/preludes`,
so hosts do not need to vendor them or read them from disk:

```ts
import { bootstrapOntologyPreludes, preludeSource } from "@formalang/ts/preludes";

const ontology = bootstrapOntologyPreludes(); // define-entity, define-action, ...
const kernel = preludeSource("kernel.lisp");
```

`bootstrapPreludes(names, options)` bootstraps any stack in order (compiler
vocabulary first, domain forms second). After editing `preludes/*.lisp`, run
`pnpm --filter @formalang/ts preludes:generate`; a test fails if the embedded
copies drift.

## Elaborating a DSL program

`elaborateProgram` runs a source file through a bootstrapped prelude in one
call. Every top-level form is recognized, checked against its descriptor
(identifiers, required slots, allowed values), and constructed into a plain
JSON payload. Problems come back as located diagnostics rather than
exceptions, one per failing form:

```ts
import { elaborateProgram, formatDiagnostic } from "@formalang/ts/descriptor";
import { bootstrapOntologyPreludes } from "@formalang/ts/preludes";

const result = elaborateProgram(source, {
  prelude: bootstrapOntologyPreludes(),
  sourceId: "model.lisp",
  forms: ["define-entity", "define-relation", "define-action"],
});
for (const declaration of result.declarations) {
  declaration.summary; // { kind: "Entity", name: "WorkOrder", resultType: "SchemaDecl" }
  declaration.payload; // JSON
  declaration.span; // sourceId, offsets, start/end line and column
}
result.diagnostics.map(formatDiagnostic); // ["model.lisp:4:1: Unknown form 'frobnicate'"]
```

Declarations have the `PackageableDeclaration` shape accepted by
`@formalang/ts/artifact`, and packaged artifacts keep two pieces of
provenance per declaration:

- `origin` is `{ kind: "authored" }`, or `{ kind: "expanded", macros }` when a
  top-level call to a `define-macro` in the same source produced the form. The
  declaration's `span` is then the macro call an author wrote.
- `sourceMap` maps JSON pointers into the payload to authored spans: `""` for
  the declaration and `/fields/0`, `/inputs/1`, ... for items built from child
  forms.

`elaborateSources` elaborates several files as one program, so declarations
may refer across files. Runtime string literals inside payloads stay tagged
(`isJsonRuntimeStringLiteral`) so they remain distinct from symbols. Use
`declarationDiagnostic` to report host-side checks at a declaration's span, and
`elaborateProgramOrThrow` when a single `ElaborationFailure` is preferable.
Typed validate and infer hooks are not run here; they belong to the type
checker.

## Ontology DSL

`@formalang/ts/ontology` elaborates the bundled ontology DSL into typed
declarations that mirror `preludes/ontology-ir.lisp`:

```ts
import { elaborateOntology } from "@formalang/ts/ontology";
import { preludeSource } from "@formalang/ts/preludes";

const { ok, model, diagnostics } = elaborateOntology([
  { sourceId: "system.lisp", source: preludeSource("system.lisp") }, // optional built-in entities
  { sourceId: "model.lisp", source },
]);
model.entities; // [{ kind: "Entity", name, fields: [{ name, type, required, indexed, span }], span, origin }]
model.relations; // source and target entity names
model.actions; // typed inputs and the :do body as a canonical runtime expression
model.queries; // :from/:select/:where, or plain Datalog data
```

Field types are parsed into `{ kind: "scalar" | "ref" | "list" | "set" | "apply" }`,
and bare entity names become refs. Unknown entities, unknown field types, and
duplicate fields are reported at the declaration that refers to them. Forms
outside the core ontology (views, processes, documents) are returned untouched
in `model.others`.

## Structural editor services

These services back outline and structural editors. Their design is in
[Language services](https://github.com/bjacobso/forma/blob/main/docs/language-services.md).

`@formalang/ts/syntax` gives every node and comment an id that survives edits.
Pass the previous source and identity with the next source:

```ts
import { identifySyntax, reconcileSyntax } from "@formalang/ts/syntax";

const identity = identifySyntax("(define total 1)");
const next = reconcileSyntax({ source: "(define total 1)", identity }, "(define total 10)");
next.nodes; // [{ id, kind, span, parent, index }], with the define's id unchanged
```

Nodes keep their ids when edits happen elsewhere, when they are retyped in
place, and when they move with identical tokens. Parsing never throws:
unterminated strings and stray characters become error nodes.

Observed evaluation records the last value, evaluation count, and failure of
every author-written expression, keyed by those ids:

```ts
import { evaluate } from "@formalang/ts/engine";

const result = await evaluate({ source, observe: { identity } });
result.observations?.records; // [{ nodeId, span, count, value, failure? }]
```

Values computed inside macro expansions are reported at the macro call and at
the arguments the author wrote, never at a macro's template. A failed
evaluation still returns the records computed before the failure.

`@formalang/ts/editor` indexes definitions and references. It resolves the
program after macro expansion, so a macro that expands to `define` defines
the author's symbol, and it reads descriptors so `define-form` declarations
define names too:

```ts
import { findReferences, indexSymbols } from "@formalang/ts/editor";

const index = indexSymbols([{ sourceId: "model.lisp", source }], { descriptors });
findReferences(index, { sourceId: "model.lisp", offset }); // { definition, references }
```

```sh
pnpm --filter @formalang/ts build
pnpm --filter @formalang/ts test
pnpm --filter @formalang/ts typecheck
```

## Effect 4 consumer migration

The next release uses `effect@4.0.0-rc.112` in its public Effect types and
runtime. Consumers should install that same version, remove any Effect 3 alias
used only for Forma, and import `Effect` directly from `effect`. Generated
Effect TypeScript and Schema modules now target the Effect 4 APIs, including
`Context.Service` and `Schema.annotate`.

Release this change through the repository's normal changeset/version workflow.
After publication, consumers can replace the Effect 3 based
`@formalang/ts@0.2.0` with the new version.
