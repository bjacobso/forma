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
`@formalang/ts/artifact`. Runtime string literals inside payloads stay tagged
(`isJsonRuntimeStringLiteral`) so they remain distinct from symbols. Use
`declarationDiagnostic` to report host-side checks at a declaration's span, and
`elaborateProgramOrThrow` when a single `ElaborationFailure` is preferable.
Typed validate and infer hooks are not run here; they belong to the type
checker.

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
