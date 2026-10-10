# RFC 0014: Extension preludes and registered generators

| | |
| --- | --- |
| Status | Proposed; not implemented |
| Created | 2026-10-10 |
| Depends on | [RFC 0002](./0002-modules-and-packages.md) stage 2 (implemented compile-time libraries) and stage 3 (proposed packages). Moving the Effect checker into the core later depends on [RFC 0003](./0003-direct-style-effects.md), [RFC 0006](./0006-qualified-rows.md), and [RFC 0008](./0008-typed-form-results.md). |
| Scope | Preludes that define DSLs; a registry of generators and runners over validated canonical IR; target syntax builders; typed bindings to TypeScript modules; Effect, HttpApi, Foldkit, and Salesforce metadata as examples |
| Direction | Preludes own meaning. Registered generators own output. Generators consume packaged IR, so they do not depend on which engine produced it. |

## Summary

An **extension prelude** defines a DSL: forms, the IR types they elaborate to,
checks, and signatures. Effect, HttpApi, Foldkit, the ontology, and a Salesforce
vocabulary are each one extension prelude. Elaboration turns authored forms into
typed IR declarations, registered validators check them, and the host packages
them as canonical IR.

A **generator** is registered separately. It consumes packaged declarations of
the IR kinds it names and produces files: Effect TypeScript, Foldkit TypeScript,
Salesforce metadata XML, or anything else. A **runner** consumes the same
declarations and supplies host builtins, so a host can run a program without
building it. A host selects a generator by name through the existing
`emit({ backend })` request.

DSLs and generators are related many-to-many. One HttpApi declaration could
produce an Effect server, a Foldkit client, and an OpenAPI document. One
Salesforce generator could read declarations from the ontology and from a
billing vocabulary. Because generators read canonical IR, which both engines
already produce, a generator never needs to be ported to a second engine.

All syntax, interfaces, and behavior below are proposed. The [Effect reference](../effect/reference.md)
and [HTTP API spike](../effect/http-api.md) describe what exists today.

## Terms

Forma already uses some of these words, so this RFC keeps their meanings:

| Term | Meaning | Status |
| --- | --- | --- |
| Elaboration | Authored forms to typed IR declarations, through a form's `:types` and `:ir` | Exists |
| Validation | Registered validators over packaged declarations | Exists (`ArtifactValidatorRegistry`) |
| Packaging | Validated declarations to an immutable canonical IR artifact | Exists |
| Backend | The name a host passes to `emit` to choose an output | Exists; only `canonical-ir` |
| Generator | A registered consumer of packaged declarations that produces files | Proposed |
| Runner | A registered consumer of packaged declarations that supplies host builtins | Proposed |

Calling generators "elaborations" would blur two phases with different rules,
so this RFC does not. Elaboration decides what a program means. A generator only
decides how that meaning is written in a target.

## Motivation

Forma's premise is that domain vocabulary is library code. `AGENTS.md` says
vocabulary "belongs in preludes and descriptors, not hardcoded compiler
concepts". Effect is the clearest exception. The [Effect page](../effect.md)
lists a closed vocabulary as a fundamental cost: new `Effect.*` combinators
require compiler support in both engines, which "contradicts Forma's own pitch
that keywords are library code."

Outputs have the same problem. Each new target is compiler work today, so a
SaaS ontology that should produce a database schema, an API, an admin UI, and
platform configuration such as Salesforce metadata would need a compiler case
for each output. Foldkit has no Forma vocabulary at all; the only relationship
today is that the structural workbench is a Foldkit app that embeds the engine.

Most of the pipeline to fix this already exists. It stops at canonical IR
because nothing else is registered after it.

## Current state

- **The pipeline.** Descriptor elaboration turns forms into packageable
  declarations, each with a kind, a payload, a payload contract, and a
  `sourceMap` from JSON pointer paths in the payload to authored spans.
  `emit` (`packages/ts/src/artifact/emit.ts`) runs elaboration, validation, and
  packaging. The host ABI's `EmitRequest` already has a `backend` field, but
  `emitBackends()` lists one backend, `canonical-ir`, and any other name is
  rejected with `abi/unsupported-backend`.
- **A registry pattern.** `ArtifactValidatorRegistry`
  (`packages/ts/src/artifact/validator-registry.ts`) is "host-owned
  registration. The packaging core has no domain-kind dispatch." Validators
  register by name and IR kind, run in batches over packaged declarations,
  and report located diagnostics through the source map. A declaration that
  names an unregistered validator gets `artifact/unknown-validator`.
- **The Effect generator already consumes declarations.**
  `generateEffectProgram` (`mechanics/elaborate.ts`) projects source to
  packageable declarations (`mechanicsPackageableDeclarations`), checks them
  (`checkMechanicsDeclarations`), and generates from them
  (`generateMechanicsEffectTypeScriptModule`, which takes
  `PackageableDeclaration[]` and the check result). The three steps are
  hard-wired together, and all of them are TypeScript.
- **Both engines produce the same Effect IR.** The OCaml engine projects Effect
  declarations to the same IR, checked by the `effect-ir` pass of the
  [engine parity runner](https://github.com/bjacobso/forma/blob/main/conformance/engine-parity/README.md).
  It does not generate Effect TypeScript
  ([Architecture](../architecture.md#effect-projection-parity)).
- **Generation inside forms.** `preludes/http-api.lisp` forms carry an `:emit`
  hook that returns quasiquoted TypeScript. `descriptor/form-emitter.ts`
  evaluates hooks with a step limit and provides target primitives (`ts/ref`,
  `ts/schema`, `ts/method`, `ts/chain`, and others). These primitives import
  Effect-specific naming and schema rendering from `mechanics/`. The OCaml
  surface reader accepts `:emit` but does not evaluate it.
- **A Salesforce vocabulary that stops at IR.** `conformance/compile-time-modules`
  has `stripe.forma` with a `price` form and `salesforce.forma` with
  `picklist-of`, which derives picklist entries from imported prices. Both
  engines elaborate it and their interfaces match a golden. Nothing emits
  Salesforce metadata.
- **Runtimes.** `makeMechanicsRuntime` interprets the original operation forms.
  `HostBuiltinDescriptor` (name, arity, type scheme, `host-effect` handler,
  purity) is the seam for host calls, which pause evaluation as a `HostCall`.
- **Two prelude mechanisms.** The descriptor bootstrap over `compiler.lisp`
  loads the domain `.lisp` preludes and `http-api.lisp`. Compile-time module
  libraries such as `kernel.forma` use ordinary imports, and a host selects a
  project's automatic imports with `configureSession({ projects: [{ prelude }] })`.

## Proposal

### The pipeline

```
author source
  │  read, expand, typecheck                      core
  ▼
forms ── elaborate ──▶ IR declarations            extension preludes
  │  :types, :ir, :check
  ▼
validate ──▶ package ──▶ canonical IR             registered validators
  │
  ├── generate ──▶ files                          registered generators
  │     effect-ts · http-api-ts · foldkit-ts · salesforce-metadata · …
  │
  └── run ──▶ host builtins                       registered runners
        effect runtime · …
```

Everything above the canonical IR decides meaning and runs in both engines.
Everything below consumes the IR and runs in a host.

### Extension preludes

An extension prelude is an ordinary compile-time module library:

- `type` declarations for its IR, which become payload contracts;
- `form` declarations with typed holes, `:ir`, and `:check` rules;
- macros, signatures, and exported declarations.

Every semantic check belongs here or in a registered validator. Registering an
extension never adds bindings implicitly. Modules import its exports, or a
project selects it as the automatic prelude, as compile-time libraries do today.

### Generators

```ts
// Proposed; does not exist today.
interface Generator {
  /** The backend name a host selects, such as "effect-ts". */
  readonly name: string;
  /** IR kinds this generator consumes, with the payload contracts it accepts. */
  readonly kinds: readonly string[];
  /** Generators this one delegates to, such as foldkit-ts → effect-ts. */
  readonly uses?: readonly string[];
  readonly generate: (
    inputs: readonly PackagedDeclaration[],
    all: readonly PackagedDeclaration[],
    context: GeneratorContext,
  ) => GeneratedFiles | { readonly diagnostics: readonly Diagnostic[] };
}

interface GeneratedFiles {
  readonly files: readonly { readonly path: string; readonly mediaType: string; readonly content: string }[];
  readonly diagnostics: readonly Diagnostic[];
}
```

A `GeneratorRegistry` follows `ArtifactValidatorRegistry`: registration is host
code, names are unique, and the packaging core does no domain-kind dispatch.
The rules:

1. **Generators consume only packaged, validated declarations.** They never see
   source text or engine internals.
2. **Generators do not decide meaning.** They do not re-check what validators
   checked. A generator may reject a valid declaration only because its target
   cannot express it, with a located diagnostic (`generate/unsupported`) placed
   through the declaration's `sourceMap`.
3. **Coverage is explicit.** When a backend is selected, a declaration whose
   kind no selected generator consumes is reported as
   `generate/no-generator`, unless the generator lists the kind as ignored.
   This mirrors `artifact/unknown-validator`.
4. **Generators are deterministic and pure.** No I/O, no clock, no randomness.
   The same packaged IR produces byte-identical files, so outputs can be
   golden-tested.
5. **Output is a file set.** Effect TypeScript is one file per module, as
   `linkEffectModules` produces today. Salesforce metadata is a directory of
   XML files. `EmitResult` grows from one artifact to a list of files.

### Selecting a backend

```ts
// Proposed. `generators` and file-set results do not exist today.
const generators = new GeneratorRegistry()
  .register(effectTs)
  .register(httpApiTs)
  .register(salesforceMetadata);

await host.emit({ sessionId, backend: "salesforce-metadata" });
await host.emitBackends(); // lists canonical-ir and every registered generator
```

`canonical-ir` becomes the first registered generator, so existing callers see
no change. The proposed `forma build` command from RFC 0002 and RFC 0013 would
take `--backend` with the same names.

### Composition

A generator can delegate to another. `foldkit-ts` renders a Command's body,
which is an Effect operation, by asking `effect-ts` for it through
`context.delegate("effect-ts", declaration)`. Delegation shares one naming and
import scope, so both generators agree on identifiers and emit a single import
list. Delegation cycles are a registration error.

### Target syntax builders

Generators produce syntax trees, and printers handle escaping and layout:

- A **TypeScript builder** generalizes `renderTypeScript` and the `ts/*`
  primitives, without importing anything from `mechanics/`. Effect naming and
  schema rendering move into the `effect-ts` generator.
- An **XML builder** handles elements, attributes, namespaces, and escaping.
  Salesforce metadata is its first user.

Generators do not concatenate raw strings into output. A Lisp `:emit` hook
becomes a convenient way to write a small generator. A prelude that declares
hooks for a backend registers a generator that runs those hooks after
packaging, using the matching builder. Hooks then run in the host's generator
phase, not inside an engine, so the OCaml engine never needs to evaluate them.

### Runners

A runner has the same registration shape as a generator. It returns host
builtins instead of files, so the playground, the workbench, or a REPL can run
declarations without a build. `makeMechanicsRuntime` becomes the Effect runner.
The workbench's `Capability` is expressed with the same descriptor, so a
library's runtime and an application's capabilities use one mechanism. Generated
code remains the primary way to run programs in production.

### Where the Effect checker goes

`checkMechanicsDeclarations` already takes declarations, so the interim step
is direct: register it as a validator over Effect IR kinds, instead of calling
it inside `generateEffectProgram`. Generators then receive only declarations
the checker accepted.

The generator also needs facts the checker computed, such as inferred body
types. Validators would attach versioned, packaged annotations to declarations,
and generators read them. Re-running the checker inside the generator would
mix the two phases again.

In the longer term, failure and requirement inference moves into core rows
through RFC 0003, 0006, and 0008, and the Effect validator becomes a thin
mapping over them.

### Foreign bindings

A `forma/typescript` extension adds `extern`, a typed binding to an export of a
TypeScript module:

```lisp
; Proposed; does not run today.
(import "forma/typescript" [extern])

(extern "effect"
  (: Duration.seconds (-> Number Duration) :purity :pure))
```

TypeScript generators reference the export and add the import. The declared
type is an assertion, like a hand-written `.d.ts` file. A runner must implement
an extern for a program that uses it to run inside a host. Until RFC 0003 gives
impure calls an effect row, only `:pure` externs are allowed, so Effect
signatures still list everything a program can touch.

### Examples

**Effect.** The extension prelude holds `schema`, `error`, `service`, `layer`,
and the body forms. A registered validator runs the Effect checker. `effect-ts`
is today's `generateMechanicsEffectTypeScriptModule`, registered, and the Effect
runner is `makeMechanicsRuntime`.

**HttpApi.** `http-api.lisp` keeps its forms. Its `:emit` hooks become the
`http-api-ts` generator, which delegates schemas and handler operations to
`effect-ts`.

**Foldkit.** An extension prelude defines `model`, `message`, `update`, and
`command`, where a Command is an Effect operation that cannot fail and resolves
to a Message. `foldkit-ts` generates the Schema model, the message union, the
update, and the commands, delegating Command bodies to `effect-ts`. Views have
no design.

**Salesforce metadata.** The existing fixture's `picklist-of` elaborates to a
`Picklist` declaration. A `salesforce-metadata` generator would write it as a
custom field:

```lisp
; billing.forma, from conformance/compile-time-modules
(price Monthly "Monthly" 1200)
(price Annual "Annual" 12000)
(define prices [Monthly Annual])

; main.forma
(picklist-of BillingPlan billing/prices)
```

```xml
<!-- BillingPlan__c.field-meta.xml: proposed generator output -->
<CustomField xmlns="http://soap.sforce.com/2006/04/metadata">
  <fullName>BillingPlan__c</fullName>
  <label>Billing Plan</label>
  <type>Picklist</type>
  <valueSet>
    <valueSetDefinition>
      <value><fullName>Stripe: Monthly</fullName><default>false</default><label>Stripe: Monthly</label></value>
      <value><fullName>Stripe: Annual</fullName><default>false</default><label>Stripe: Annual</label></value>
    </valueSetDefinition>
  </valueSet>
</CustomField>
```

The entries carry the `Stripe: ` prefix because the fixture's private
`display-label` helper adds it during elaboration. The generator only writes
what the IR says.

## Engine parity

- Both engines must elaborate extension preludes to the same IR. The parity
  runner already compares this, including the `effect-ir` pass.
- Generators and runners consume packaged IR and run in a host, so they have
  no engine-specific implementation. A generator's output must be identical
  whichever engine produced the IR, and that becomes a parity check.
- Lisp `:emit` hooks run in the generator phase, so the OCaml engine does not
  need to evaluate them.

## Trust

Validators, generators, and runners are host code. Registering one is a host
decision, comparable to installing an npm package, and it is not sandboxed.
Lisp `:emit` hooks run with a step limit and no capabilities. Under
[RFC 0012](./0012-checked-evaluation.md), a runner's builtins are capabilities
like any other and must be granted.

## Alternatives considered

- **Keep generation inside forms**, as `:emit` does today. Each form would know
  its targets, so adding a target means editing every prelude, and the hooks
  need an engine to run them.
- **Keep extensions in the compiler.** This gives the best diagnostics today,
  but every DSL and every target becomes work in two engines.
- **A public checker-plugin API in TypeScript.** This moves Effect out fastest,
  but it splits the engines and freezes internal checker types as public API.
  Validators over packaged IR already give checks a public, engine-neutral input.
- **Emit template strings.** Raw strings give up escaping, import tracking, and
  byte-stable output.
- **Generate externs from `.d.ts` files first.** This is useful later.
  Conditional types, overloads, and variance do not map directly onto Forma
  types, so hand-written externs come first.

## Implementation stages and validation

1. **A generator registry.** Add `GeneratorRegistry` and file-set results.
   Register `canonical-ir` as the first generator, and have `emitBackends` list
   the registry. Validation: canonical IR output and the unsupported-backend
   diagnostic are unchanged.
2. **Effect, registered.** Register `checkMechanicsDeclarations` as a validator
   with packaged annotations, and `generateMechanicsEffectTypeScriptModule` as
   the `effect-ts` generator. `generateEffectProgram` becomes a wrapper.
   Validation: every `conformance/effect-typescript` case keeps byte-identical
   output, strict `tsc`, passing harnesses, and identical rejection diagnostics.
3. **Generation from either engine's IR.** For the `effect-ir` parity cases,
   generate `effect-ts` from IR produced by the OCaml engine. Validation: the
   output is identical to the output from IR produced by the TypeScript engine.
4. **HttpApi hooks as a generator.** Run `http-api.lisp`'s hooks as the
   `http-api-ts` generator after packaging, delegating to `effect-ts`.
   Validation: the `http-api` case and the generated builder DSL are unchanged.
5. **The first non-TypeScript target.** Add the XML builder and a
   `salesforce-metadata` generator for the compile-time-modules fixture's
   `Picklist`. Validation: golden XML and a well-formedness check.
6. **A library-neutral TypeScript builder, and externs.** Move Effect naming and
   schema rendering into `effect-ts`, and add `forma/typescript` with `:pure`
   externs. Validation: an import-graph test keeps the builder free of
   `mechanics/` imports, and all goldens are unchanged.
7. **A Foldkit spike.** Model, messages, update, and commands through
   `foldkit-ts` delegating to `effect-ts`, compiled and run with Foldkit in a
   test. No views.
8. **Runners.** Register `makeMechanicsRuntime` as the Effect runner and express
   workbench capabilities with the same descriptor.
9. **The checker in the core.** After RFC 0003, 0006, and 0008, move failure
   and requirement inference to core rows in both engines. Validation: every
   `reject-*` case keeps its diagnostic messages and spans.

Every stage must leave the existing Effect and HTTP API goldens unchanged. A
stage that changes generated output is a separate, reviewed change.

## Decisions still required

- The format of validator annotations, and their versioning against generators.
- The file-set result shape in the host ABI, and how generated paths relate to modules.
- The delegation API and how delegating generators share names and imports.
- How a generator declares the payload contract versions it accepts.
- Registration through package manifests (RFC 0002 stage 3) versus host code.
- Whether `:emit` hooks stay on forms or move into separate generator modules.
- Whether XML output is checked against target schemas (XSD) or only for well-formedness.
- Ordering when several selected generators produce the same output path.
- Whether extern types stay assertions or are checked against `.d.ts` files in CI.
- Foldkit commands' interaction with effect rows, and views.

## Related designs

Pandoc converts between document formats through one shared document tree, with
separate readers and writers registered around it. Racket builds languages as
libraries on a shared macro and module system; see
[Languages as Libraries](https://doi.org/10.1145/1993498.1993514) (Tobin-Hochstadt
et al., PLDI 2011). Gleam declares foreign functions per compile target with
its `@external` attribute, and PureScript uses `foreign import` with a matching
JavaScript module. Both treat the declared type as trusted, as `extern` does here.
