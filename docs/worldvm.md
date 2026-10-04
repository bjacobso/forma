# WorldVM Program IR

> [!NOTE]
> This is a design note. Nothing on this page is built, and the planned
> `@worldvm/*` packages are not published.

[WorldVM](https://worldvm.com) is a TypeScript runtime and standard library for
software that models the world, reasons about it, and acts on it. Its planned
standard library is `@worldvm/*`. Programs are written in TypeScript against
the planned `@worldvm/program` package, and Runfold is the engine that
interprets them.

Forma's relationship to WorldVM is optional and one-way. If a textual,
homoiconic authoring language proves worth having, Forma compiles to WorldVM
Program IR. WorldVM never requires Forma, never depends on a Forma package, and
never sees a Forma-specific node. Forma keeps its standalone purpose as a typed
homoiconic Lisp for building DSLs.

This note maps Forma's current elaboration and artifact pipeline to that
target and lists what is missing.

## What the backend would have to guarantee

- **No Forma-only IR.** A Program elaborated from Forma must be
  indistinguishable from one written in TypeScript against `@worldvm/program`.
  Source spans and declaration provenance may travel as optional metadata.
- **WorldVM owns the schema.** Forma consumes the Program IR schema; it does not
  define it or extend it.
- **No placeholders.** Like the Effect TypeScript generator, the backend fails
  when a node has no translation. It never emits a stub program.
- **The dependency points one way.** Any adapter lives in this repository and
  depends on `@worldvm/program`, never the reverse.

## What exists today

Forma has two pipelines that produce program-shaped output. Neither targets
WorldVM.

### Operational effects (mechanics)

`define-schema`, `define-error`, `define-service`, and `define-operation`
produce `SchemaDef`, `ErrorDef`, `ServiceDef`, and `EffectDef` payloads. An
`EffectDef` carries:

- an inferred `Effect<A, E, R>` contract;
- an `authority.capabilities` list;
- a typed body.

Body nodes are a closed set:

- `ServiceCall` and `OperationCall`
- `Succeed`, `Fail`, `Bind`, `Do`, and `Pure`
- `Let`, `If`, `When`, `Unless`, `Cond`, `Match`, and `Catch`

Every node carries its effect and source span.

Both engines emit these payloads, and the engine parity runner compares them
against `conformance/operational-effects`. The TypeScript engine also runs them
in its mechanics runtime and generates Effect TypeScript from them. This is the
most portable and best-tested program shape Forma has.

### Domain elaboration (example preludes)

`preludes/ontology.lisp` and `preludes/ontology-compiler.lisp` describe forms
such as `define-entity`, `define-query`, `define-action`, `define-constraint`,
`define-permission`, and `define-process`. The OCaml canonical-ir backend
elaborates them into declarations such as `Entity`, `Query`, `Action`,
`Constraint`, and `Process`. `Process` is a trigger plus a graph of nodes and
guarded edges.

These preludes are example vocabularies for exercising elaboration. They are
not WorldVM's world model or its Program IR, and they have three limits:

- **Only the OCaml engine elaborates them.** The TypeScript engine does not.
- **Bodies are not lowered.** Action `:do` bodies, process node inputs, and
  edge guards are carried as source-shaped expressions. Their
  `ExecutableRuntimeExpr` type is referenced but not defined.
- **Little output is pinned.** The corpus golden checks only declaration counts
  and a manifest hash for processes and actions, not their payloads.

`preludes/action-protocol.lisp` and `preludes/canonical-runtime-protocol.lisp`
sketch typed action plans: create, patch, link, emit, and return steps. They
are schemas only. No elaboration hook produces them.

### The forma-zero kernel

`conformance/forma-zero` runs a small operational kernel on both engines. Facts
are triples, grants are facts, and actions are reactions to invocation facts.
An admission loop authorizes proposals before appending them, and a workflow
step graph is stored as facts. The TypeScript engine's typed-authority check
statically infers which fact attributes a reaction can emit. This is evidence
that the core language can express the semantics. It is not a runtime and not
an IR.

## Mapping to WorldVM concepts

| WorldVM concept | Closest thing in Forma | Gap |
| --- | --- | --- |
| Program | `EffectDef` typed body | Needs a lowering to Program IR nodes |
| Capability | `Service.method` requirement strings in `R` | No identity or scope beyond the string |
| Connection | `define-service` methods | No notion of an external system or credentials |
| Change | `ActionPlan` effects in `action-protocol.lisp` | Schema only; nothing produces it |
| Query | `Query` declarations and `QueryPlan` | Example vocabulary, not WorldVM's Query |
| Entity, Fact, Relation | `Entity` and `Relation` declarations; forma-zero triples | Example vocabulary, not WorldVM's world model |
| Policy | `define-permission`; forma-zero grants; typed authority | No `PermissionDeclaration` in the corpus; typed authority is TypeScript-only |
| Event | `emit` steps with a string event name | Untyped payloads; no declaration form |
| Thread, Signal, Timer | None (`NodeExecution` has a `wake-at` field) | No forms or IR |
| Actor | None | No forms or IR |

## Recommended path

Start from operational effects, not from the domain preludes. Mechanics
payloads are already typed and closed, and both engines agree on them. They
already have one generated target that refuses to emit unsupported code.

A WorldVM backend would sit beside `generateMechanicsEffectTypeScriptModule` in
`@formalang/ts/mechanics`. It would:

1. read the same `mechanicsPackageableDeclarations` output;
2. map `ServiceCall` requirements to WorldVM capabilities and connections;
3. map `Fail` and `Catch` to typed program failures;
4. map control flow to Program IR nodes;
5. throw on anything it cannot translate, including the raw `Expr` fallback.

The domain-elaboration path comes later, if ever. A `define-process` graph
should elaborate into the same program shape rather than define a second
workflow IR. Entity and query forms targeting WorldVM should consume WorldVM's
world-model types through a prelude rather than continue Forma's parallel
example vocabulary.

## What is missing

1. **A published Program IR schema.** This is the blocker. Forma cannot target
   a schema that WorldVM has not defined, and it should not define one on
   WorldVM's behalf.
2. **A capability mapping.** `R` is a set of `Service.method` strings. WorldVM
   capabilities and connections need an agreed identity scheme before the
   mapping is more than a naming convention.
3. **Typed bodies in the domain path.** Action bodies, process guards, and node
   inputs need lowering to typed core before any of them can become Program IR.
4. **A Change producer.** Nothing elaborates into a typed change set today.
   `ActionPlan` would need an elaboration hook and fixtures, or should be
   replaced by WorldVM's Change type.
5. **Thread, Signal, Timer, Event, and Actor forms.** None exist. If they are
   needed, they should arrive as prelude forms that mirror WorldVM kernel
   primitives, not as compiler built-ins.
6. **An emit surface on the shared host.** `LanguageHost` has no artifact or
   emit methods. Artifacts come only from the OCaml daemon's emit operations,
   and the two engines use different artifact envelopes.
7. **Conformance.** The backend needs a fixture pinning the expected Program IR
   for `conformance/operational-effects`, validated against the published
   WorldVM schema. A parity entry should record which engines implement it.

## Proposed sequence

None of these steps has started.

1. WorldVM publishes a versioned Program IR schema with `@worldvm/program`.
2. Add a `conformance/worldvm-program` fixture that pins the expected IR for the
   operational-effects program.
3. Add a TypeScript generator beside the Effect TypeScript generator, failing
   on unsupported nodes.
4. Record the OCaml engine as a parity gap, or add an OCaml emit backend once
   the TypeScript output is stable.
5. Revisit processes, changes, and threads only after a real consumer needs
   them from Forma rather than from TypeScript.

This follows the roadmap rule that a new backend needs a concrete consumer and
a conformance target.
