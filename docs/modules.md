# File modules

RFC 0002 stage 1 implements isolated file modules in the TypeScript and Native
OCaml engines. A file's definitions are private. Source loading registers files;
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

The implicit core consists of the existing kernel builtins and bundled kernel
prelude, primitive/container types, and the current Effect-value authoring forms.
Configured host variables and preludes are explicit additions to this core.
Ordinary source files never extend it. Exported macros, forms, and typeclasses require stage 2 and receive a located diagnostic.
Local macros can still expand references to helpers in their own module.

## Host and browser use

Both `TsLanguageHost` and `NodeOcamlLanguageHost` support the same source-bundle,
`moduleGraph`, `typecheck`, `expand`, `evaluateInSession`, and
`linkEffectModules` workflows. The TypeScript host and `@formalang/ts/modules`
entry point work in browsers without filesystem APIs:

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
normalized relative paths. The Node adapter in `@formalang/ts/node` and the Native
CLI use canonical filesystem paths. Cycles report the complete import chain;
missing files, private exports, collisions, and namespace mistakes report the
importing author's span.

Kernel module evaluation initializes pure definitions once per runtime instance
and dependency version. Entry expressions run on explicit evaluation; importing
that file does not run those expressions. Updating a file creates new instances
for it and its dependents. Observation requests create a fresh entry instance so
that the complete execution can be observed. Effect programs execute through the
linked Effect target; kernel evaluation reports `module/effect-runtime` instead
of executing an Effect initializer. The experimental JS OCaml host still lacks
persistent sessions; use the browser TypeScript host for file modules.

## Linked Effect TypeScript

The runnable five-file example is in `conformance/modules/`. It imports a
polymorphic function, branded IDs, a class, tagged constructors, and an Effect
service. Its `main` export is an Effect value. Importing the generated files
prepares that value; application code supplies the service and runs the Effect.

After building the engines:

```sh
pnpm --filter @formalang/ts build
pnpm --filter @formalang/host build
pnpm build:ocaml
node scripts/link-forma-modules.mjs conformance/modules/main.forma .context/linked native
# The same linker accepts independently checked TS declarations:
node scripts/link-forma-modules.mjs conformance/modules/main.forma .context/linked-ts ts
# The Native CLI can inspect or check files directly:
packages/ocaml/dist/native/forma_cli.exe file interface conformance/modules/main.forma
packages/ocaml/dist/native/forma_cli.exe file typecheck conformance/modules/main.forma
```

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
file module. Importing form definitions and linking domain projection libraries
remain stage 2 work. Manifests,
registries, lockfiles, package imports, compile-time libraries, project commands,
and RFC 0003 direct-style effects remain proposals.
