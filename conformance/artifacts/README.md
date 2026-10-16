# Artifact boundary fixtures

These fixtures were first captured from the retired OCaml engine's artifact
gates. They are now reviewed expectations for the TypeScript artifact
pipeline, checked by `packages/ts/test/artifacts.test.ts` (and, for
`descriptor-cases.json`, `packages/host/test/prelude-metacheck.test.ts`).
There is no producer script; edit them deliberately and review the diff.

- `payload-cases.json`: 30 typed and malformed payload cases, plus three
  named-validator cases. Expected diagnostic codes are stored alongside each
  source; diagnostic prose follows the TypeScript validator.
- `summary-cases.json`: declaration summary contracts and explicit HTTP
  validator selection.
- `http-cases.json`: schema references, error declarations, and invalid HTTP
  shapes.
- `descriptor-cases.json`: artifact metacheck cases.
- `envelope.json`: structural assertions about the emitted artifact (name, kind,
  media type, backend, required collections, span fields). Version, engine
  metadata, and hash algorithm are not part of it.
- `module-cases.json`: import, export, re-export, declaration identity, and
  public export hash expectations.
- `corpus-golden.json`: the corpus summary over the Markdown examples.
  TypeScript checks all 58 sources, 548 declarations, and exact kind/module
  counts. Its stored manifest hash came from the OCaml engine and is not the
  TypeScript declarations hash; it is not compared.

TypeScript also checks `../fixtures/canonical-ir/expected.json`, the website's
stored canonical IR example, by projecting declarations, provenance, module
identities, and type summaries. Session/engine metadata and source/declarations
hashes are not compared: that file holds the OCaml `CanonicalIr` v1 envelope
(MD5, serialization order), while TypeScript emits `language-ts-artifact/v1`,
which preserves its declaration wrappers and hashes sorted-key canonical payload
JSON with SHA-256.

Prelude loading calls `checkArtifactDescriptor` through `checkDescriptors`, with
`checkArtifactPayloadContracts` for named contracts. Both return diagnostics and
accept source locations; they do not bootstrap, evaluate, or perform I/O.

Module entries project authored imports/exports and packaged declarations; module
resolution and typechecking remain in the existing module stage. Emission does
not expose artifact cache telemetry. `artifactSummary` requires successful
validation and returns kind counts and manifest metadata. The HTTP validator
also checks map schemas and handler signatures.
