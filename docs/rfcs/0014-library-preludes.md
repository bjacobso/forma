# RFC 0014: Library preludes and compile targets

| | |
| --- | --- |
| Status | Proposed; not implemented |
| Created | 2026-10-10 |
| Depends on | [RFC 0002](./0002-modules-and-packages.md) stage 2 (compile-time libraries) and stage 3 (packages); [RFC 0003](./0003-direct-style-effects.md), [RFC 0006](./0006-qualified-rows.md), and [RFC 0008](./0008-typed-form-results.md) for moving the Effect checker |
| Scope | A library format with forms, target, and native layers; registered compile targets; typed bindings to TypeScript modules; moving Effect out of the core compiler; Foldkit as a second library |
| Direction | Effect and Foldkit become library preludes. The core keeps types, rows, elaboration, a library-neutral TypeScript target, and the host ABI. |

## Summary

A library prelude is an ordinary compile-time module library plus two optional
parts: emit hooks for a registered compile target, and a native layer that
supplies host builtins for evaluation inside a host. The core provides one
TypeScript target that knows nothing about any particular library. A
`forma/typescript` library adds typed `extern` bindings to TypeScript modules.

Effect would move into a library in stages, starting with code generation and
ending with the checker once effect rows exist in the core type system.
Foldkit would be the second library, to show the format is not shaped around
Effect. Libraries are also how Forma would expose other npm packages and new
compile targets, instead of adding cases to both engines.

All syntax and behavior below are proposed. The [Effect reference](../effect/reference.md)
and [HTTP API spike](../effect/http-api.md) describe what exists today.

## Motivation

Forma's premise is that domain vocabulary is library code. `AGENTS.md` says
vocabulary "belongs in preludes and descriptors, not hardcoded compiler
concepts". Effect is the clearest exception. The [Effect page](../effect.md)
lists a closed vocabulary as a fundamental cost: new `Effect.*` combinators
require compiler support in both engines, which "contradicts Forma's own pitch
that keywords are library code."

The same page lists a second cost: Forma code cannot import TypeScript
functions or types or call an npm package. Anything outside the built-in
vocabulary has to be a service implemented in TypeScript and provided as a
layer.

Each new library repeats both problems. Foldkit has no Forma vocabulary at
all; the only relationship today is that the structural workbench is a Foldkit
app that embeds the engine. Adding Foldkit, `@effect/platform`, or SQL the way
Effect was added would mean more TypeScript in the TypeScript engine and more
OCaml in the OCaml engine for each one.

The HTTP API spike shows another way is already partly possible. Its forms
declare syntax, typed IR, and TypeScript emission in Lisp, and a second
generator derives a typed builder DSL from the same declarations.

## Current state

- **Effect is compiler code.** `packages/ts/src/mechanics/` is about 9,400 lines
  of TypeScript. The main parts are `check.ts` (the Effect checker, including
  failure and requirement inference), `artifact.ts` (form projection, which
  matches combinator heads such as `acquire-release`, `race`, and `retry`),
  `effect-typescript.ts` and `effect-schema.ts` (generation), `builtins.ts`
  (value functions, each with a checker signature and a TypeScript
  translation), and `runtime.ts` (`makeMechanicsRuntime`).
- **The OCaml engine projects Effect but does not generate it.** Its
  `mechanics_*.ml` modules and `abi_effect_typecheck.ml` project declarations and
  bodies to canonical IR. Per [Architecture](../architecture.md#effect-projection-parity),
  "OCaml currently emits canonical IR; it does not emit Effect TypeScript."
  Generation already belongs to one engine only.
- **Prelude emit hooks exist in one spike.** `preludes/http-api.lisp` forms carry
  `:types`, `:ir`, and an `:emit` hook that returns quasiquoted target syntax.
  `packages/ts/src/descriptor/form-emitter.ts` evaluates the hooks with a step
  limit and provides the target primitives `ts/ref`, `ts/schema`, `ts/schemas`,
  `ts/children`, `ts/declaration`, `ts/operation`, `ts/chain`, `ts/method`,
  `ts/arrow`, and `ts/spread`. `ts/code` accepts only compiler-produced
  expressions. These primitives import mechanics naming and schema rendering,
  so the target is not yet independent of Effect. The OCaml surface reader
  accepts `:emit` but does not evaluate it.
- **There are two prelude mechanisms.** The older descriptor bootstrap
  (`bootstrapFromSources` over `compiler.lisp`) loads the domain `.lisp` preludes
  and `http-api.lisp`. Compile-time module libraries such as `kernel.forma` use
  ordinary imports, and a host selects a project's automatic imports with
  `configureSession({ projects: [{ prelude }] })`; see [File modules](../modules.md#compile-time-libraries).
- **Host builtins are the runtime seam.** A `HostBuiltinDescriptor` has a name,
  an arity, a type scheme, a `host-effect` handler, and a purity. Calls pause
  evaluation as a `HostCall` until the host resumes them. The workbench's
  `Capability` and `DeclarationCheck` configuration are application-level
  versions of the native layer proposed here.
- **No packages, no target selection.** Manifests, package imports, and
  `forma build --target` are RFC 0002 stage 3 proposals.

## Proposal

### A library has three layers

1. **Forms layer** (portable). A compile-time module library: types, `form`
   declarations with `:types`, `:ir`, and `:check`, macros, signatures, and
   exported declarations. Both engines must elaborate it identically.
2. **Target layer** (portable). `:emit` hooks keyed by target name. A hook is a
   pure compile-time function from validated IR to target syntax. It runs under
   a step limit, with no capabilities, in either engine.
3. **Native layer** (optional, per engine). Host builtins that implement the
   library's operations for evaluation inside a host (the playground, the
   workbench, a REPL), and declaration checks that cannot yet be written in
   Forma. A native layer names the engines it supports.

A library with no native layer is portable. A library whose native layer exists
only for the TypeScript engine is labeled TypeScript-only, and the engine parity
matrix records it as an intentional difference.

### Registering a library

Under RFC 0002 stage 3, the package manifest gains library fields:

```toml
# forma.toml. Proposed; not implemented.
[package]
name = "effect"
version = "0.1.0"

[library]
prelude = "src/prelude.forma"
targets = ["effect-ts"]

[foreign.typescript]
effect = "4.0.0-rc.112"

[native]
typescript = "native/index.ts"
```

Until packages exist, a host registers the same information next to the
project prelude it already supports:

```ts
// Proposed; `libraries` does not exist today.
await host.configureSession({
  sessionId,
  libraries: [{ id: "effect", prelude: "effect/prelude.forma", native: effectNative }],
  projects: [{ id: "shop", base: "shop/project", prelude: "effect", modules }],
});
```

Registering a library never adds bindings implicitly. Modules import its
exports, or a project selects it as the automatic prelude, exactly as for
compile-time libraries today.

### Compile targets

A target has a name, a syntax vocabulary, a printer, and a module model for
imports and exports. The core provides one target language, `typescript`: a
small expression and declaration syntax that generalizes `renderTypeScript`,
with import tracking and identifier rules, and no knowledge of Effect.

Libraries define named targets on top of it. The Effect library would define
`effect-ts`: its naming conventions, schema rendering, and imports, which today
live in `mechanics/naming.ts` and `mechanics/effect-schema.ts`. A library can
extend another library's target; `http-api` would extend `effect-ts`.

- Selecting a target uses the proposed `forma build --target effect-ts` and the
  host's existing `emit` operations with a target name.
- A declaration with no emitter for the selected target is a located
  diagnostic, matching today's rule that generation fails on unsupported nodes
  instead of producing placeholder code.
- Library hooks cannot produce raw code. `ts/code` stays internal to the core
  printer, so escaping, import tracking, and cross-engine comparison remain
  possible.

### Foreign bindings: `forma/typescript`

```lisp
; Proposed; does not run today.
(import "forma/typescript" [extern])

(extern "effect"
  (: Duration.seconds (-> Number Duration) :purity :pure))
```

`extern` introduces a typed binding whose implementation is an export of a
TypeScript module. Generated code references the export, and the module model
adds the import. The declared type is an assertion, like a hand-written `.d.ts`
file. Forma does not check it against TypeScript.

Evaluation inside a host requires the native layer to implement the binding as
a host builtin. Otherwise evaluating it reports a located "not available in
this host" diagnostic.

Effect programs keep their guarantee that a signature lists everything the code
can touch. An impure extern therefore needs an effect row to say where it can
be called. Until RFC 0003 provides one, only `:pure` externs are allowed, and
I/O stays behind services as it does today.

### Where the checker goes

Most of the Effect checker's value is inference for `E` and `R`, closed error
sets, and method-level requirements. A form's `:types` contract cannot express
these. The proposal is to put the general machinery in the core and leave only
the mapping in the library:

- Effect rows for failures and requirements come from RFC 0003, and closed or
  qualified rows from RFC 0006.
- Declarative result types for forms come from RFC 0008.
- The Effect library then maps a checked row to `Effect.Effect<A, E, R>` in its
  target layer.

Until those exist, the current checker stays in the core, but only the Effect
library can enable it, through a named checker extension. This keeps the
dependency explicit. It is not a public plugin API; see the alternatives below.
Checks that only inspect IR, such as rejecting an impossible `catch`, can move
to the library as `:check` hooks earlier, if their diagnostics keep the same
messages and spans.

### The runtime

Generated TypeScript remains the way to run a library's programs. Evaluating
library forms inside a host uses the native layer's host builtins, so
`makeMechanicsRuntime` becomes the Effect library's TypeScript native layer.
The workbench's `Capability` would be expressed with the same descriptor, so an
application's capabilities and a library's runtime use one mechanism.

### Effect after the move

| Today | After this RFC |
| --- | --- |
| Effect forms projected in `mechanics/artifact.ts`; OCaml `mechanics_*.ml` | Forms layer of the Effect library |
| `mechanics/builtins.ts` signatures and translations | Signatures in the forms layer; translations as `effect-ts` emit hooks |
| `mechanics/effect-typescript.ts`, `mechanics/effect-schema.ts` | `effect-ts` target layer |
| `ImportName` and hardcoded `effect` imports | `extern` declarations through `forma/typescript` |
| `mechanics/check.ts` | Core rows (RFC 0003 and 0006); a named checker extension in the meantime |
| `mechanics/runtime.ts` | TypeScript native layer |

### Foldkit as the second library

A second library tests whether the format fits something other than Effect.
Foldkit models and messages are Effect Schemas (`defineMessageUnion` in the
workbench), so the forms map onto declarations Forma already checks:

```lisp
; Proposed; does not run today.
(import "foldkit" [model message update])

(model Counter {:count Int})
(message Msg (Increment) (Reset {:to Int}))

(update Counter Msg [model msg]
  (match msg
    (Increment) [(assoc model :count (+ model.count 1)) []]
    (Reset {:to to}) [(assoc model :count to) []]))
```

The library would emit a Schema model, a message union, and an update function
for Foldkit. It needs no native layer, because Foldkit is the runtime. Commands
need effect rows to say what they can touch, so they wait for RFC 0003. Views
have no design: `preludes/ui.lisp` defines a renderer-neutral `ComponentIR`,
and nothing emits Foldkit views from it.

## Engine parity

- Both engines must elaborate the forms layer to the same IR. The existing
  parity runner covers this.
- Both engines must evaluate emit hooks to the same target syntax. The OCaml
  engine would have to evaluate `:emit`, which it parses but ignores today.
  The comparison should be on target syntax trees, so that only one printer is
  required.
- Native layers are declared per engine. A library missing a native layer for
  an engine is recorded in the parity matrix, not silently skipped.

## Trust

Emit hooks are pure Forma with a step limit and no capabilities. Native layers
are arbitrary host code that runs at compile time and during evaluation inside a
host. Loading one is a host decision, comparable to installing an npm package,
and it is not sandboxed. Under [RFC 0012](./0012-checked-evaluation.md), a native
layer's builtins are capabilities like any other and must be granted.

## Alternatives considered

- **Keep libraries in the compiler.** This gives the best diagnostics today. But
  every library becomes work in two engines, and it keeps the contradiction the
  Effect page names.
- **A public checker-plugin API in TypeScript.** This is the fastest way to
  move Effect out. It splits the engines, freezes internal checker types as
  public API, and lets each library's error messages drift from the core's.
- **Write everything in Forma, including the runtime.** This is the most
  portable option. But runtimes need I/O and their target's libraries, and host
  builtins are already the seam for that.
- **Emit template strings.** Raw strings give up import tracking, escaping, and
  cross-engine comparison. `ts/code` is internal for this reason.
- **Generate externs from `.d.ts` files first.** This is useful later.
  Conditional types, overloads, and variance do not map directly onto Forma
  types, so hand-written externs come first.

## Implementation stages and validation

1. **A library-neutral TypeScript target.** Re-express the `ts/*` primitives on a
   core target that does not import `mechanics/`. Validation: HTTP API output and
   the generated builder DSL are byte-identical, and an import-graph test keeps
   the target module free of `mechanics/` imports.
2. **The first registered library.** Migrate `http-api.lisp` from the descriptor
   bootstrap to a compile-time module library registered through
   `configureSession`. Validation: the `http-api` conformance case passes with
   diagnostics at the same author spans.
3. **Effect code generation as a library.** `effect-ts` emit hooks replace
   `effect-typescript.ts` and `effect-schema.ts` for the supported subset, and the
   checker stays in the core behind the named extension. Validation: all
   `conformance/effect-typescript` cases keep their output byte-identical, pass
   strict `tsc`, and pass their behavior harnesses. Report the lines removed from
   `mechanics/`.
4. **Foreign bindings.** Add `forma/typescript` with `:pure` externs. The Effect
   library declares its imports with them, and `ImportName` is removed.
5. **Foldkit spike.** A counter with a model, messages, and update, generated,
   compiled, and run with Foldkit in a test. No commands or views.
6. **Runtime as a native layer.** Move `makeMechanicsRuntime` behind the Effect
   library's native layer and express workbench capabilities with the same
   descriptor.
7. **The checker.** After RFC 0003, 0006, and 0008, move failure and requirement
   inference to core rows in both engines. Validation: every `reject-*` case in
   the Effect conformance suite keeps its diagnostic messages and spans.

Every stage must leave the existing Effect and HTTP API goldens unchanged. A
stage that changes generated output is a separate, reviewed change.

## Decisions still required

- Library manifest fields, versioning, and resolution, together with RFC 0002 stage 3.
- Whether cross-engine comparison uses target syntax trees or printed text.
- Whether extern types stay assertions or are checked against `.d.ts` files in CI.
- How impure externs interact with effect rows once RFC 0003 exists.
- Ordering and conflict rules when one library extends another library's target.
- Whether library `:check` hooks can match the current Effect checker's diagnostics.
- Foldkit commands and views.
- What happens to hosted evaluation of Effect forms that `makeMechanicsRuntime` does not interpret today.

## Related designs

Racket builds languages as libraries on a shared macro and module system; see
[Languages as Libraries](https://doi.org/10.1145/1993498.1993514) (Tobin-Hochstadt
et al., PLDI 2011). Gleam declares foreign functions per compile target with
its `@external` attribute, and PureScript uses `foreign import` with a matching
JavaScript module. Both treat the declared type as trusted, as `extern` does here.
