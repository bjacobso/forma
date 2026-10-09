# Artifact boundary fixtures

These fixtures retain OCaml as the behavior oracle while testing TypeScript.
No OCaml gate scripts are removed or rewritten.

- `payload-cases.json`: the 30 typed and malformed payload cases from
  `packages/ocaml/scripts/emit.mjs`, plus its three named-validator cases.
  Sources are unchanged. Expected diagnostic codes are stored alongside them;
  diagnostic prose follows each engine's validator implementation.
- `summary-cases.json`: declaration summary contracts and explicit HTTP
  validator selection from `packages/ocaml/scripts/emit.mjs`.
- `http-cases.json`: schema references, error declarations, and invalid HTTP
  shapes matching `packages/ocaml/lib/http_ir_validation.ml`.
- `descriptor-cases.json`: artifact metacheck cases from
  `packages/ocaml/scripts/descriptor-preludes.mjs`.
- `envelope.json`: engine-neutral structural assertions from
  `packages/ocaml/scripts/emit-golden.mjs`. Each engine retains its version,
  engine metadata, and hash algorithm.
- `module-cases.json`: OCaml-generated import, export, re-export, declaration
  identity, and public export hash expectations.
- `corpus-golden.json`: the complete `corpusGolden` from
  `packages/ocaml/scripts/gates.mjs`. TypeScript checks all 58 sources, 548
  declarations, and exact kind/module counts. The stored OCaml manifest hash
  remains the OCaml oracle; it is not the TypeScript declarations hash.

TypeScript also checks `../fixtures/canonical-ir/expected.json`, the website's
OCaml-generated golden, by projecting declarations, provenance, module
identities, and type summaries. Session/engine metadata and source/declarations
hashes are engine-specific. TypeScript's `language-ts-artifact/v1` preserves
its declaration wrappers and hashes sorted-key canonical payload JSON with
SHA-256; OCaml's `CanonicalIr` v1 uses MD5 and serialization order. The decision
is recorded in `../engine-parity/matrix.json`.

The descriptor metacheck integration seam is `checkArtifactDescriptor`, with
`checkArtifactPayloadContracts` for named contracts. Both return diagnostics and
accept source locations; they do not bootstrap, evaluate, or perform I/O.

Module entries project authored imports/exports and packaged declarations; module
resolution and typechecking remain in the existing module stage. Emission does
not expose OCaml's artifact cache telemetry. TypeScript `artifactSummary`
requires successful validation and returns kind counts and manifest metadata;
OCaml can aggregate declaration/diagnostic counts across failing sources.
The HTTP validator also checks TypeScript map schemas and handler signatures,
which are stronger than the OCaml reference.
