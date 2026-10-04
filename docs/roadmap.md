# Roadmap

## Current foundation

- Lossless reader, formatter, macro expansion, evaluator, and TypeScript VM.
- Hindley–Milner inference with descriptor-aware typed core.
- Operational effect inference and portable effect artifacts.
- Native, JavaScript, and WebAssembly OCaml builds behind a shared JSON ABI.
- Cross-engine host, editor analysis, language server, and conformance suites.
- Browser compiler explorer with live intermediate stages.

## Next

1. Tighten the shared language specification around observable cross-engine
   behavior and turn remaining parity assumptions into fixtures.
2. Stabilize the host ABI and artifact schema around a small set of end-to-end
   consumer examples.
3. Improve incremental analysis, package caching, and editor latency without
   weakening source provenance.
4. Define the JavaScript/Wasm distribution model for the OCaml engine and the
   eventual public `@forma` packages.
5. Add a supported consumer-prelude SDK and document how to build a complete
   typed domain language.

## Deferred

- General-purpose application-language positioning.
- A stable package or wire-format compatibility promise.
- Automatic registry publication or website deployment.
- Additional backends without a concrete consumer and conformance target.
- A WorldVM Program IR backend. It waits on a published IR schema and a
  conformance target; see the [design note](/worldvm).
