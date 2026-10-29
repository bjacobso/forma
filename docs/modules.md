# File modules

RFC 0002 implements isolated file modules and a stage 2 compile-time library
slice in the TypeScript engine. A file's definitions are private. Source loading registers files;
it does not publish their bindings into a host session.

```lisp
;; identity.forma
(export identity)
(define identity [value] value)

;; names.forma
(export Name label)
(type Name (Brand String))
(: label (-> Name String))
(define label [name] (str "Hello, " name))

;; main.forma
(import "./identity.forma" [identity])
(import "./names.forma" :as names)
(export greeting)
(define greeting (names/label (names/Name (identity "Ada"))))
greeting
```

Named imports expose only the selected exports. Namespace aliases use `/`;
`names/Name` and `names/label` retain their original declaration identities.
Each imported polymorphic function is instantiated independently at each call.
A barrel preserves those identities:

```lisp
;; public.forma
(export-from "./names.forma" [Name label])
```

Exporting a tagged type makes its constructors available through that type:

```lisp
;; status.forma
(export Status)
(type Status (Tagged (Ready {:message String}) Empty))

;; reader.forma
(import "./status.forma" [Status])
(Status.Ready {:message "Ready"})
;; Ready is not a bare imported name.
```

Classes and errors retain nominal identity; brands and tagged types from two
files remain distinct even when their names and representations match. All
stage-1 type exports are transparent. Public signatures must export the owning
nominal types and services they mention. Constructor-only and opaque exports
are not implemented.

The implicit module core consists of intrinsic syntax, evaluation primitives,
primitive/container types, and the current Effect-value authoring forms. `type`,
`class`, `error`, `service`, `layer`, and `do!` remain built in. Kernel sugar can be
imported from `preludes/kernel.forma`; it is not automatically loaded into file
modules. Explicitly configured host variables remain available. Source-loading
and legacy descriptor-prelude APIs do not add library bindings to module scopes.
Typeclass instance imports and coherence remain deferred.

## Compile-time libraries

Forms and macros use the same imports and visibility rules as values and types.
A form retains its defining module's private projection helpers, patterns, hole
types, checks, contracts, and editor metadata. Macro helper references retain
definition-site identity; caller syntax retains caller bindings. The implemented
hygiene covers generated `fn` and `let` binders; other binding constructs still
need further work.

```lisp
;; stripe.forma
(export price)
(type PriceDecl Symbol)
(type PriceIR {:name Symbol :label String :amount Int})
(define display-label [label] (str "Stripe: " label))
(form (price name label amount)
  :types {:name (Declares PriceDecl) :label String :amount Int}
  :ir PriceIR
  {:name name :label (display-label label) :amount amount})

;; billing.forma
(import "./stripe.forma" [price])
(export Monthly Annual prices)
(price Monthly "Monthly" 1200)
(price Annual "Annual" 12000)
(define prices [Monthly Annual])
```

`Declares` contracts introduce declaration exports. Each declaration has its
invoking module's identity and a classification, declaring-form identity, and
source span. During pure elaboration it is a descriptor with `:identity`,
`:classification`, and `:data`. Private helpers retain the form library's scope.
The `prices` export is inspectable pure data for another form's typed data hole.
Exported types carry public schema syntax. Declaration and data interfaces carry
compile-time schemes separately from runtime schemes; classification does not
manufacture a runtime constructor.

The complete [Stripe → Salesforce fixture](https://github.com/bjacobso/forma/tree/main/conformance/compile-time-modules)
uses `billing/prices` to derive picklist entries and checks imported references
at their authored spans. Data provenance contains paths into the elaborated
value and source declaration identities and spans. It conservatively includes
all contributing input declarations on every derived member. Selection and
transformation do not yet track minimal per-member input sets.

A host selects each project's automatic imports through `configureSession`:

```typescript
await host.configureSession({
  sessionId,
  projects: [{
    id: "billing",
    base: "billing/project",
    prelude: "./prelude.forma",
    modules: ["billing/main.forma", "billing/prelude.forma"],
  }],
});
```

`base` is the resolver's importing-file base: the example resolves the setting to
`billing/prelude.forma`. A project's source modules receive the selected module's
exports under ordinary named-import collision rules. The prelude and its explicit
dependency closure bootstrap without that project's automatic imports. Each
module uses its owning project's selection, so two projects can use distinct
form libraries in the same graph. No setting means no automatic library imports.

Pure projections can retain `RuntimeExpr` syntax describing a future `update!`;
they do not invoke it. Executable Effects still require the existing explicit
runner. Graph requests rebuild compile-time interfaces from current sources,
including private helper dependencies.

## Runtime projections from form libraries

A module-defined form can opt into a runtime projection with `:lower`. The
projection runs after its ordinary hole checks and IR contract validation. It
receives the checked IR and returns a quoted vector of ordinary Forma
declarations:

```lisp
;; vocabulary.forma
(export operation)
(type OperationId Symbol)
(type OperationIR {:name Symbol :signature Type :body RuntimeExpr})

(form (operation name signature body)
  :types {:name (Declares OperationId) :signature Type :body RuntimeExpr}
  :ir OperationIR
  :lower (fn [ir]
    `[(: ~(get ir :name) ~(lower-syntax (get ir :signature)))
      (define ~(get ir :name) ~(lower-syntax (get ir :body)))])
  {:name name :signature signature :body body})

;; counter.forma
(import "./vocabulary.forma" [operation])
(export increment)
(operation increment (-> Int Int) (fn [count] (+ count 1)))
```

`increment` retains its declaration identity, classification, and inspectable
compile-time IR. Its runtime facet has a separately checked function signature.
Other modules can import it, re-export it through a barrel, and call it as an
ordinary function. The compiler checks the lowered bodies; a `RuntimeExpr` hole
does not bypass typechecking. Forms without `:lower` remain compile-time data.
Compile-time forms, metadata schemas, and data do not become JavaScript imports
or exports merely because a module exports them to Forma consumers.

`lower-syntax` is available only while executing `:lower`. It reinserts syntax
retained in the IR, preserving list/vector shape and author locations. Template
nodes point at the form application; reinserted expressions keep their own spans.
Private runtime helper references retain their defining module. Introduced `fn`
and `let` binders are freshened using the same hygiene rules as module macros.
Other binding constructs retain the macro system's existing hygiene limits.

The current projection must define every `Declares` binding exactly once, with
optional signatures. It may emit only `define` and `:` for those bindings. It
cannot introduce unregistered top-level names, imports, schemas, or another form
application. Declare schemas and services with ordinary module forms. There is no
recursive runtime-lowering protocol or arbitrary TypeScript escape in this stage.
This hook is implemented in the file-module pipeline; standalone legacy artifact
generators do not automatically consume it. `:emit` remains the separate target
adapter hook.

Zero-argument callbacks have the type `(-> Result)`, distinct from both `Result`
and `(-> Unit Result)`. For example, `(fn [] (load id))` can capture arguments and
return an Effect when invoked. A constructor can return such a callback through
its own Effect success type, keeping constructor and invocation errors and Service
requirements separate. The Effect target still requires effect-body forms to live
in operations; pure callbacks can invoke named operations to build deferred work.
Inferred module signatures also retain the parameter groups of returned functions.
For example, `(-> Int (-> Model Model))` has two calls: the first supplies an
operation's argument, and the second applies its pure Step to a Model.

The [runtime module fixture](https://github.com/bjacobso/forma/tree/main/conformance/runtime-modules)
checks a library-defined operation, typed arguments, a deferred callback, a handler
constructor, Service imports, and barrel exports. Its harness strictly compiles
the generated TypeScript and executes it against success and failure Service
Layers. Importing performs no Service work; constructor work runs once per
execution, and the returned callback retains its captured value.

## Host and browser use

`TsLanguageHost` supports source-bundle, `moduleGraph`, `typecheck`, `expand`,
`evaluateInSession`, and `linkEffectModules` workflows. The host and the
`@formalang/ts/modules` entry point work in browsers without filesystem APIs:

```typescript
import { TsLanguageHost } from "@formalang/host/ts-host";

const host = new TsLanguageHost();
const { sessionId } = await host.openSession();
await host.loadSourceBundle({
  sessionId,
  sources: [
    { kind: "source", sourceId: "identity.forma",
      source: "(export identity) (define identity [value] value)" },
    { kind: "source", sourceId: "main.forma",
      source: '(import "./identity.forma" [identity]) (identity 42)' },
  ],
});
const checked = await host.moduleGraph({ sessionId, sourceId: "main.forma" });
const evaluated = await host.evaluateInSession({ sessionId, sourceId: "main.forma" });
await host.closeSession({ sessionId });
```

Loading order does not affect resolution. The host supplies a synchronous resolver
`(specifier, importerId) => { id, source } | undefined`. In-memory bundles resolve
normalized relative paths. The Node adapter in `@formalang/ts/node` and the `forma`
CLI use canonical filesystem paths. Cycles report the complete import chain;
missing files, private exports, collisions, and namespace mistakes report the
importing author's span.

Kernel module evaluation initializes pure definitions once per runtime instance
and dependency version. Entry expressions run on explicit evaluation; importing
that file does not run those expressions. Updating a file creates new instances
for it and its dependents. Observation requests create a fresh entry instance so
that the complete execution can be observed. Effect programs execute through the
linked Effect target; kernel evaluation reports `module/effect-runtime` instead
of executing an Effect initializer.

## Linked Effect TypeScript

The runnable five-file example is in `conformance/modules/`. It imports a
polymorphic function, branded IDs, a class, tagged constructors, and an Effect
service. Its `main` export is an Effect value. Importing the generated files
prepares that value; application code supplies the service and runs the Effect.

After building the TypeScript packages:

```sh
pnpm --filter @formalang/ts build
pnpm --filter @formalang/host build
node scripts/link-forma-modules.mjs conformance/modules/main.forma .context/linked
# The host package installs the forma executable; from a checkout:
node packages/host/dist/cli.mjs file interface conformance/modules/main.forma
node packages/host/dist/cli.mjs file typecheck conformance/modules/main.forma
```

The TypeScript `forma` executable also accepts a JSON request argument or stdin:

```sh
forma request '{"op":"typecheck","sourceId":"example.forma","source":"(+ 1 2)"}'
printf '%s\n' '{"op":"parseSummary","source":"1 2"}' '{"op":"version"}' | forma daemon
forma file evaluate path/to/main.forma
forma file declarations path/to/main.forma
```

`daemon` reads one JSON object per line and writes one response per line. Sessions
persist across requests, which run in input order. Every response has `ok` and
`diagnostics`, and successful operations expose their host projection in `value`.
Typecheck also exposes its display string in `type`. Malformed requests use
`abi/*` diagnostics, author errors keep their compiler codes and source spans,
and unexpected engine failures use `internal/error`. Request failures do not
terminate the daemon. Filesystem failures use `io/error`.

The exported `@formalang/host/json-abi` entry provides `JsonRequest`, `JsonResponse`,
`TypeScheme`, and `JsonValueProjection` Effect schemas and a `JsonAbi` dispatcher.
Its operations cover parsing, expansion, typechecking, evaluation, modules,
session configuration, loading, retained values, and suspended host calls.
It also dispatches `emit`, `emitMany`, `emitBackends`, `artifactSummary`, and
stateful typed `replSubmit`. Artifact requests use `sessionId`, `sourceId` or
`sourceIds`, and optional `backend` (only `canonical-ir` is implemented).
`emit` also accepts inline `source`, with optional `sourceId` (default `request`),
against the loaded preludes without storing it. With no selection, the host emits
all loaded sources. `sourceId` takes precedence over `sourceIds`.
`replSubmit` requires `sessionId` and `source`, accepts the session evaluation
options, and retains bindings and types only on success. Its completed envelope
includes the display string in `type`.

Responses carry the host projections inside `value`: REPL results have `status`
and `result` (or a suspended host call). `emitMany` returns per-source
`artifacts` arrays. Artifacts use the validated `language-ts-artifact/v1`
package and SHA-256 canonical JSON hashes. Summary failures return diagnostics
rather than aggregate counts across failing sources. Artifact cache counters
are not implemented.
Failure diagnostics also appear once at the envelope level; `emitMany` preserves
successful per-source results when another source fails.

The remaining optional `LanguageHost` methods are editor APIs:
`analyzeEditor`, `identifySyntax`, `symbolIndex`, `findReferences`, `applyEditScript`,
`describeNodes`, `editScriptSchema`, `sourceToOutline`, `outlineToSource`, and
`formSlots`. They remain available through the in-process host, which carries
syntax identities and editor projections; this process ABI covers compiler and
session operations. Elaboration is not a separate ABI operation. The standalone `elaborateProgram` and `elaborateSources` APIs in `@formalang/ts/descriptor` return declaration projections;
use session `emit`/`emitMany` for validated, packaged artifacts.
Host schemes reject unknown names and malformed structure, including nested
schemes. `Int` and `Float` are distinct host types; `Number` and `Num` are rejected
in source annotations and host schemes. Tagged values preserve numeric kinds, with explicit Float payloads
`"NaN"`, `"Infinity"`, `"-Infinity"`, and `"-0"` for values JSON numbers cannot
round-trip. Plain JSON erases numeric kinds and maps nonfinite Floats to null. Invalid configuration names its JSON path and locates the affected
symbol, or uses a zero-width source span when no symbol occurs.

The debug operations `lowerCore`, `typecheckCore`, and `typecheckCoreTyped` return
TypeScript core trees and inferred display types; typed trees add `inferredType`
to expression nodes.
`parseSummary` reports the top-level form count. `incrementalSummary` reports
per-form spans and a stable FNV-1a 64-bit digest of UTF-8 AST shape JSON, ignoring
spans, comments, and whitespace. These are structural change hints, not persistent artifact identities.

`loadSource` and `loadSourceBundle` accept `timings: true`. Load results include
millisecond durations for the phases executed: `parseMs` and `storeMs`, plus
`typecheckMs`, `evalMs`, and `metacheckMs` for preludes. The timing contract also
reserves `elaborateMs`; absent phases were not run. Failed loads include timings
for phases completed before the diagnostic and preserve the session snapshot.

`linkEffectModules` returns one `.ts` file per module, the generated entry filename,
portable interfaces, declarations, and diagnostics. Files contain real relative
ES imports and exports. Each schema, brand, service, class, and tagged constructor
is emitted in its owning file. Generated filenames and identifiers encode the
host's module ID; use the returned interfaces and `generatedBindingName` to locate
an authored export. The integration fixture compiles this output with `tsc` and
runs it with Effect, asserting zero calls at import and one call on execution.

The target retains its existing supported Effect subset. Inferred closed,
polymorphic pure function signatures are supported. Generic schemas, inferred
open-row signatures, and variadic functions require further target work and report
diagnostics. The existing domain artifact APIs still resolve symbolic declaration
data and global seed IDs in their artifact reference index. That index supplies
artifact hooks with data; it never supplies functions or lexical bindings to a
file module. File module interfaces now expose compile-time libraries and checked declaration
data. Migrating these legacy artifact emit pipelines to those interfaces remains
follow-up work. Manifests, registries, lockfiles, package imports, project commands,
and RFC 0003 direct-style effects remain proposals.
