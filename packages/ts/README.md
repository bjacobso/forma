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

`bootstrapFromSources` from `@formalang/ts/descriptor` works in Node and browsers.
Filesystem bootstrapping is available from the Node-only entry point:

```typescript
import { bootstrapFromFiles } from "@formalang/ts/node";

const prelude = bootstrapFromFiles("preludes/compiler.lisp", "preludes/ontology.lisp");
```

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

Declarations have the unvalidated `PackageableDeclaration` shape.
`validateDeclarations(session, declarations)` returns immutable
`ValidatedDeclaration` snapshots or diagnostics; `packageArtifact` accepts
only those snapshots. Canonical payload schemas cover every ontology kind.
Descriptors select named validators and payload contracts through their
artifact extension; hosts can extend `ArtifactValidatorRegistry` and pass it
as `validatorRegistry` to elaboration or emission.

Packaged artifacts keep two pieces of provenance per declaration:

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

Session `emit`, `emitMany`, `emitBackends`, and `artifactSummary` are exported
from `@formalang/ts/artifact`. The implemented backend is `canonical-ir`.
Emission elaborates loaded sources, validates declarations and HTTP contracts,
then packages an `ir.json` artifact with modules, provenance, declaration/type
summaries, and a derived manifest. TypeScript's `language-ts-artifact/v1`
envelope retains declaration wrappers and uses SHA-256 over sorted-key
canonical payload JSON. OCaml retains its v1 envelope and MD5 hash; shared
fixtures check the declaration and module projections instead of requiring
identical envelopes.

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

Edit scripts describe structural changes by node id instead of by offset.
They are Effect Schema data, and `editScriptJsonSchema()` is the same contract
as JSON Schema for a model's structured output:

```ts
import { applyEditScript, describeNodes } from "@formalang/ts/editor";

describeNodes(source, identity, [stepId]); // kind, text, head, path, top-level form
const result = applyEditScript({
  source,
  identity,
  script: { version: 1, ops: [{ op: "wrap", targets: [aId, bId], head: "parallel" }] },
});
if (result.ok) result.source; // layout kept; result.identity keeps the wrapped nodes' ids
```

Operations are `replace`, `insert`, `delete`, `wrap`, `splice`, `unwrap`,
`raise`, `move`, `rename` (scope-aware, refusing captures), and `extract`
(free locals become parameters). A script applies completely or not at all.

The outline codec reads source as rows (`{ id, text, children }`) in the
style of indentation-sensitive Lisp, where a row's text holds the leading
elements of its list and its children hold the rest. Row ids are node ids:

```ts
import { outlineToSource, sourceToOutline } from "@formalang/ts/syntax";

const { items, identity } = sourceToOutline("(defn total [x]\n  (* x 2))");
// [{ text: "defn total [x]", children: [{ text: "* x 2" }] }]
const printed = outlineToSource(items, { base: { source, identity } });
printed.source; // unchanged rows keep the author's layout
```

`formSlots` reports which identifiers and slots a descriptor form accepts,
which are present or still empty, and an edit-script insertion for each, so
an editor can offer placeholders such as `+ trigger`:

```ts
import { formSlots } from "@formalang/ts/editor";

const slots = formSlots({ source, offset, descriptors });
slots?.slots; // [{ name: "from", required: true, missing: false, placeholder: "+ from", insertion }]
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

## Descriptor typing and definition checks

Descriptor `:infer-fn`, `:check-fn`, `:bindings-fn`, and `:result-type-fn` hooks
participate in HM inference and checking. Hook expression checks use the active
lexical environment and substitution. Binding hooks introduce bindings only
inside their application. Typed slots, including repeated slots and positional
child slots, produce diagnostics at the authored expression. Prelude and
source-local hooks are available in the analysis workspace, including hover.
Ordinary functions referenced as hooks and their reachable helpers are loaded
in the meta environment. Their bodies are evaluated when the hook runs; they are
excluded from ordinary program inference like `__form-hook` declarations.

The session loader can call this plain synchronous stage, exported from
`@formalang/ts/descriptor`:

```typescript
function checkDescriptors(
  sources: readonly { sourceId: string; source: string }[],
  options?: CheckDescriptorsOptions,
): readonly Diagnostic[];
```

`options.prelude` supplies previously registered forms and hooks.
`resolveHook(name)` recognizes additional session/native hooks.
`checkReferences: false` defers unresolved-hook and constructed-by reference
checks until dependencies have loaded; clause shape and application slot checks
still run. Malformed descriptors return located diagnostics.

`checkForm(form, span)` is the extension point for artifact payload contracts,
validators, and artifact summary requirements. This stage does not load,
evaluate, or mutate a session. The session-load workspace owns integration into
host prelude loading. Shared expectations and intentional OCaml differences are
recorded in `conformance/thesis-gate/` and `conformance/descriptor-metacheck/`.
