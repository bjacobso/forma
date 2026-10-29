# Elm-style app prototype

The [Elm landing page](/elm) explains the pitch and trade-offs. This is an
isolated **TypeScript-engine prototype**, targeting `foldkit@0.168.0` and
`effect@4.0.3`. It has no general HM/editor support.

`preludes/elm.lisp` defines the forms, typed declaration IR, and target adapter
emit hooks. `generateElmProgram` links their expressions through the existing
Effect mechanics checker. No new application concepts live in the core checker.

## Generate and mount

```ts
import { writeFileSync } from "node:fs";
import { generateElmProgram } from "@formalang/ts/elm";

const result = generateElmProgram(source, { sourceId: "counter.lisp" });
if (!result.ok) throw new Error(result.diagnostics.map(d => d.message).join("\n"));
writeFileSync("counter.ts", result.code!);
```

The result includes located diagnostics and packageable declarations, and emits
code only after all checks succeed. Generated code imports Effect and Foldkit,
with no Forma runtime. Supply host services as a Foldkit resource layer:

```ts
import { Runtime } from "foldkit";
import { Counter } from "./counter.js";

Runtime.run(Runtime.makeElement({
  ...Counter,
  container: document.getElementById("counter"),
  resources: CounterStoreLive, // A host-defined Effect layer.
}));
```

## Complete source

<<< @/snippets/elm/counter.lisp

## Forms

| Form | Contract |
| --- | --- |
| `(msg Increment (GotCount {:count Int}) ...)` | One closed `Msg` schema per source. Nullary or record-payload variants; constructors and pattern destructuring follow the Effect tagged-union vocabulary. |
| `(command load-count fetch-count :ok [n message] :error [(Error e) message ...])` | Wrap a declared zero-argument Effect value. Every declared error must have a tag-specific mapping; mappings must return Msg. Requirements come from the operation's signature. Omit `:error` only when its error set is empty. |
| `(update [model message] Pattern (with next-model :command...) ...)` | Every message needs an explicit case. Wildcards are rejected. Each branch returns a checked model and declared command keywords, without running effects. |
| `(view [model] [:div ...])` | A Hiccup tree with `:div`, `:span`, and `:button`. Text and `:class` expressions return String; `:on-click` expressions return Msg. All expressions are pure. Buttons generate `type="button"`. |
| `(app Counter :model Model :init (with (Model {...}) :command...))` | One app per source; validates the initial model and commands. Exports a configuration compatible with Runtime.makeElement. |

Use the ordinary [Effect forms](/effect/reference) for model schemas, errors,
services, pure helpers, and operations. Command effects retain the service
requirements in their declared signature. Host TypeScript supplies those services;
Forma does not implement HTTP, database, or npm adapters here.

`with` is a transition expression inside update and init. It can appear within
ordinary control flow such as `if` and `let`. It creates data; the generated
adapter creates Foldkit Commands, which the runtime executes after update returns.
Multiple commands in a transition are independent concurrent work, not a sequence.
Commands share the app message schema in their Foldkit definition; the prototype
does not derive a narrower per-command union for developer tooling.

The generator reserves `Msg`, `ElmTransition`, generated `elm-*` helpers, and the
Foldkit adapter names. Collisions produce diagnostics. The general Effect checker also validates
names, schemas, pure functions, effect signatures, and service requirements.

## Checks and evidence

The [counter fixture](https://github.com/bjacobso/forma/tree/main/conformance/effect-typescript/cases/elm-counter)
has an exact TypeScript golden, strict typechecking without type escapes,
artifact validation, and a headless init/update/command harness. Neighboring
`elm-*` rejection cases pin exact authored line/column diagnostics.

A command has no **typed** failure channel after recovery. This does not rule out
Effect defects, interruption, divergent functions, or exceptions in trusted host
adapters. A pure view cannot call services or run Effect operations; arbitrary
JavaScript callbacks and unsafe HTML are outside the supported surface.

The landing page's live embed intentionally uses the existing Effect dialect for
its command half. The browser worker and language server do not recognize the full
app DSL yet. Use the generator from a build script, not the hosted interpreter.

## Design and remaining work

`with` pairs a model with named work rather than mirroring Foldkit factories.
Hiccup fits a Lisp tree; the existing ontology-driven `ui.lisp` / ViewSpec has a
different data model and remains independent. A future component bridge needs to
preserve typed events and model bindings across those surfaces.

The general [file-module pipeline](/modules#runtime-projections-from-form-libraries)
supports library-defined runtime projections, separate compile-time and runtime
interfaces, and deferred zero-argument callbacks with checked Effect channels.
These are compiler foundations for reusable application features. This Elm
generator does not yet use that pipeline: `block`, child Bindings, operations,
OutMessages, checked composition graphs, and the newer Foldkit handler Layer
adapter remain unimplemented. Its Foldkit and Effect version targets are unchanged.

Command arguments, subscriptions, cancellation, managed resources, routing,
input events, dynamic child lists, a component system, SSR, hydration, module
linking, and source maps are unimplemented. Subscriptions need model-driven
lifetime/teardown semantics, distinct from one-shot commands.

Sharing the [HttpApi declarations](/effect/http-api) with generated client
commands is **proposed**. Endpoint changes do not currently alter Msg or force a
frontend update change. The two prototypes check their contracts separately.
