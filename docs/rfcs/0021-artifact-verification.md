# RFC 0021: Independent artifact verification

| | |
| --- | --- |
| Status | Proposed; not implemented |
| Created | 2026-10-25 |
| Scope | A separate `@formalang/verify` package, envelope decoding, integrity, reference resolution, effect-set consistency of mechanics payloads, `forma verify`, mechanics checking during emit, mutation fixtures |
| Direction | A small program that trusts none of the compiler checks what an emitted `ir.json` claims, so a consumer does not have to trust the engine that produced it |

## Summary

`forma verify ir.json` reads an artifact and checks it without the reader,
expander, typechecker, descriptor machinery, or elaborator:

```text
ir.json  language-ts-artifact/v1  548 declarations
  envelope      ok
  integrity     ok   declarationsHash matches
  references    ok
  effects       FAIL CheckoutLive.checkout calls Orders.create,
                     which its declared requirements do not include
REJECTED
```

The verifier is its own package with no dependency on `@formalang/ts`. It
decodes the envelope against a published schema, recomputes hashes, resolves
references between declarations, and rechecks that every mechanics operation's
body stays within its declared errors and requirements. The engine's own
emit path also starts running the mechanics checker, so the two agree on
correct output and differential tests catch them disagreeing.

## Motivation

Forma's design decisions say that
[artifacts cross a typed boundary](../design-decisions.md#artifacts-cross-a-typed-boundary):
a host validates, reviews, and executes what a program elaborates into. Today the only evidence
that an artifact satisfies its own declarations is that the engine produced
it. The engine that must be trusted for that is large: about 2,300 lines of
reader, 800 of expander, 9,000 of type checker, 10,600 of descriptor
machinery, 9,500 of mechanics, 2,900 of modules, and 2,000 of surface
lowering. [RFC 0012](./0012-checked-evaluation.md) says plainly that the
engine is an in-process interpreter, not a security boundary.

Bend's `--verdict` rechecks proofs with a small kernel, separate from the
checker used while writing, and can write the kernel's input out for review.
A reviewer then trusts the kernel, not the whole toolchain. Bend formalizes
its kernel in Lean; the shipping checker still differs from the model, which
is a useful warning about what such a check does and does not establish.

Forma does not need a formal kernel to get most of the benefit. Artifacts are
JSON with declared effects. A program a few thousand lines long can check that
what an artifact says about its effects is consistent with the bodies it
contains, and a host receiving an artifact from a cache, a CI job, or a model
can run it before executing anything.

## Current state

- **Envelope.** `ArtifactPackage` (`packages/ts/src/artifact/artifact.ts`)
  has `irVersion: "language-ts-artifact/v1"`, `kind: "CanonicalIr"`,
  `hashAlgorithm`, `declarationsHash`, `declarationCount`, `modules`,
  `declarationTypeSummaries`, `declarationProvenance`, `derivedArtifacts`,
  `typeSummary`, `engine`, `session`, `preludes`, `sources`, `declarations`,
  and `diagnostics`. Each declaration has a `summary` with a string
  `resultType`, a `payload`, provenance, and optional `payloadContract`,
  `validators`, `origin`, and `sourceMap`.
- **Hashing.** `declarationsHash` is SHA-256 over sorted-key canonical JSON of
  the payloads (`artifact/canonical-json.ts`).
- **Effects live in payloads.** Mechanics payloads (`FunctionDef`,
  `EffectDef`, `ServiceDef`, `LayerDef`, and others) embed declared `errors`
  and `requirements` arrays and lowered bodies (`mechanics/artifact.ts`).
  There is no envelope-level effect table.
- **Validation happens before packaging, in the engine.**
  `validateDeclarations` checks structure, summaries, and payload constraints;
  `ArtifactValidatorRegistry` adds domain payload schemas, hand-written
  mechanics shape validators (`artifact/mechanics-payloads.ts`), HTTP
  validation, and descriptor contracts. Validated declarations are branded
  through a module-private `WeakMap`, an in-process token that serialized
  output cannot carry.
- **Emit does not check effects.** `emit` (`artifact/emit.ts`) projects
  mechanics declarations with `mechanicsPackageableDeclarations` and validates
  their shape, but does not call `checkMechanicsDeclarations`. That checker,
  which reads JSON mechanics IR and reports `mechanics/undeclared-error`,
  `mechanics/undeclared-requirement`, `mechanics/missing-method`, and others
  (`mechanics/check.ts`), runs in `generateEffectProgram`,
  `linkEffectModules`, and the Elm, email, and HTTP pipelines. In the HTTP
  validator its diagnostics are discarded.
- **No reader for artifacts.** There is no JSON Schema or decoder for the
  envelope, no parser from serialized module type syntax back to checker
  types, and no host operation or command that checks an existing `ir.json`.
  Tests compare `canonicalIrProjection(artifact)` with goldens
  (`packages/ts/test/artifacts.test.ts`, `conformance/artifacts/`).
- **Corpus.** `conformance/artifacts/corpus-golden.json` covers 58 sources and
  548 declarations.

## Proposal

### Package

`packages/verify` publishes `@formalang/verify`. Its dependencies do not
include `@formalang/ts`, and a test fails if any source file imports from it
or from a path inside it. It may depend on Effect for schema decoding. The
target size is under 3,000 lines, small enough to review in full. Where it
needs the same rule as the engine, such as requirement coverage
(`Service` covers `Service.method`), it implements that rule again rather than
importing it. Two implementations of a small rule are the point; the
differential tests below keep them in agreement.

```ts
interface VerifyRequest {
  readonly artifact: unknown;                            // parsed ir.json
  readonly sources?: ReadonlyMap<string, string>;        // sourceId -> text
  readonly interfaces?: readonly unknown[];              // dependency module interfaces
}
interface VerifyResult {
  readonly status: "verified" | "rejected";
  readonly checks: readonly {
    readonly name: "envelope" | "integrity" | "references" | "effects" | "trust";
    readonly status: "ok" | "failed" | "skipped";
  }[];
  readonly diagnostics: readonly Diagnostic[];           // code verify/*, span from provenance
}
```

### Checks

Checks run in order. A later check is skipped if an earlier one fails.

1. **Envelope.** Decode against a JSON Schema for `language-ts-artifact/v1`,
   published under `conformance/artifacts/schema/` and generated from the
   same definitions the engine uses to package. An unknown `irVersion` is
   rejected with `verify/version`. Mechanics payloads are decoded against
   the body node vocabulary, not only their outer shape.
2. **Integrity.** Recompute `declarationsHash` and `declarationCount`. Check
   that provenance indexes, `formIndex` values, and `sourceMap` pointers are
   in range. When `sources` are given, check their hashes and that every span
   lies inside its source.
3. **References.** Every `Ref` schema, service name, layer `:provides`,
   operation call, and error name in a payload resolves to a declaration in the
   artifact or an export of a supplied dependency interface.
4. **Effects.** For each mechanics operation, function, and layer method,
   compute the errors and requirements its body can produce from its nodes:
   service calls, operation calls at the callee's declared sets, `fail`,
   `catch` removing the errors it handles, and `provide` discharging the
   requirements it supplies. Check that they are within the declared sets, that
   pure functions call no service, and that each layer implements every member
   of the service it provides. Success types are not rechecked in this stage.
5. **Trust.** When [RFC 0020](./0020-trust-facts.md) summaries are present,
   check that a declaration reported as `checked` references no declaration
   that assumes something, and that `trustBase` lists every host builtin the
   bodies call.

Diagnostics use `verify/*` codes, registered in the
[RFC 0017](./0017-diagnostic-catalog.md) catalog, and map spans back to author
source through `declarationProvenance` and `sourceMap`.

### Commands and operations

- `forma verify <ir.json> [--sources <dir>] [--json]` prints one line per
  check and exits 0 only when the artifact is verified.
- `forma verify --explain` also prints, for each mechanics declaration, the
  effect summary the verifier computed next to the declared one. This is the
  reviewable form of what was checked, like Bend's `-o PROOF.bendtt`.
- A host operation, `verifyArtifact`, runs the same checks. The host calls the
  verifier package, not the engine.

### Emit checks effects

`emit` runs `checkMechanicsDeclarations` on the mechanics declarations it
packages and fails with its diagnostics. Effect-set errors are then caught at
the point of production, and the verifier's job is to confirm, not to be the
first check. This is a behavior change: a source with an inconsistent Effect program
that emits today stops emitting, as it already fails in
`generateEffectProgram`.

### Differential tests

- Every artifact produced from the corpus verifies.
- `conformance/artifacts/verify-cases.json` lists mutations of real
  artifacts, each with the expected `verify/*` code: a requirement removed
  from a declared set, a service call added to a pure function, a layer member
  deleted, a dangling `Ref`, a changed payload with the old hash, an
  out-of-range provenance index, and an unknown `irVersion`.
- For each mechanics fixture in `conformance/effect-typescript/`, the
  engine's checker and the verifier must agree on acceptance. A disagreement is
  a defect in one of them.

## Alternatives considered

- **Reuse the engine's mechanics checker as the verifier.** It already reads
  JSON IR, but it is about 3,000 lines inside a 58,000-line package and
  shares types and helpers with the code that produced the artifact. A defect
  in a shared helper would pass both.
- **Sign artifacts instead.** A signature says who produced an artifact, not
  whether it is consistent. Both are useful; signing is a distribution
  concern for later.
- **Formalize a kernel.** A machine-checked model would say more, but
  Bend's experience shows the model and the implementation drift apart unless
  the implementation is extracted from it. Differential tests against the
  engine are cheaper and test the code that runs.
- **Recheck domain payloads too.** Domain IR depends on preludes. The verifier
  can check payloads against their `payloadContract` types once artifacts
  carry those type definitions (see decisions), but it cannot know what an
  `entity` means.

## Implementation stages and validation

1. **Emit checks effects.** Run the mechanics checker in `emit`, with
   fixtures for an inconsistent Effect program that no longer emits.
2. **Package, envelope, and integrity.** `@formalang/verify`, the published
   schema, hash and provenance checks, the import-boundary test, and
   `verify/version`, `verify/hash`, and `verify/provenance` mutation cases.
3. **References and effects.** Checks 3 and 4, the mutation cases for them,
   and the agreement test against `conformance/effect-typescript/`.
4. **Commands.** `forma verify`, `--explain`, and `verifyArtifact`, pinned by
   tests that run the binary.
5. **Trust.** Check 5, after RFC 0020 stage 2.

## Decisions still required

- Whether artifacts should embed the `:ir` type definitions their payload
  contracts name, so the verifier can check domain payload shapes.
- Whether the verifier should recheck success types in mechanics bodies,
  which roughly doubles its size.
- Whether a verified artifact should carry a verification record, or whether
  verification always happens at the consumer.
- Whether the verifier should accept an artifact whose `engine` version it has
  not seen, if `irVersion` matches.

## Related designs

Bend's [guide](https://github.com/bendlang/bend/blob/main/guide/GUIDE.md)
describes `--verdict`, which rechecks proofs with a small kernel and can
write the kernel's input out for review. The de Bruijn criterion, followed by
Lean, Rocq, and HOL Light, keeps the trusted checker small and separate from
the tools that build terms. WebAssembly validation and the JVM bytecode
verifier let a runtime check code it did not compile.
