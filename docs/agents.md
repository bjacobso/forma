# Forma

> Forma is a pre-alpha typed, homoiconic Lisp for building domain-specific languages and portable artifacts. Install the TypeScript engine with `pnpm add @formalang/ts`, or try the browser playground at https://forma-lang.com/playground.

APIs, package boundaries, syntax, and artifact formats are still evolving.
There is no published `forma` CLI. The TypeScript engine powers the browser
tools; the OCaml engine builds to native code, JavaScript, and WebAssembly.
Shared conformance fixtures define their portable semantic intersection.
The structural workbench currently depends on unpublished Foldworks packages.

## Getting started

- [Quick start](https://raw.githubusercontent.com/bjacobso/forma/main/README.md): Setup, examples, package layout, and current project status.
- [TypeScript engine](https://raw.githubusercontent.com/bjacobso/forma/main/packages/ts/README.md): Embedding the reader, evaluator, typechecker, VM, and elaborator.
- [Language guide](https://raw.githubusercontent.com/bjacobso/forma/main/docs/language.md): Syntax, values, types, macros, effects, and elaboration.
- [File modules](https://raw.githubusercontent.com/bjacobso/forma/main/docs/modules.md): Explicit imports, exports, compile-time form libraries, and project preludes.

## For agents

- [Writing a form](https://raw.githubusercontent.com/bjacobso/forma/main/docs/writing-a-form.md): Define domain vocabulary with preludes, descriptors, and elaboration hooks.
- [Architecture](https://raw.githubusercontent.com/bjacobso/forma/main/docs/architecture.md): Engine boundaries, host ABI, artifacts, and current parity differences.
- [Forma for Effect](https://raw.githubusercontent.com/bjacobso/forma/main/docs/effect.md): Generate Effect TypeScript from checked Forma declarations and programs.
- [Effect reference](https://raw.githubusercontent.com/bjacobso/forma/main/docs/effect/reference.md): Supported schemas, services, errors, resources, and operations.
- [Language services](https://raw.githubusercontent.com/bjacobso/forma/main/docs/language-services.md): Analysis, node identity, observations, and structural edit scripts.

## Optional

- [Workbench](https://raw.githubusercontent.com/bjacobso/forma/main/packages/workbench/README.md): Structural editing, reviewable proposals, capability approvals, setup, and first-release limits.
- [Conformance](https://raw.githubusercontent.com/bjacobso/forma/main/conformance/README.md): Fixtures and checks that pin implemented engine behavior.
- [Roadmap](https://raw.githubusercontent.com/bjacobso/forma/main/docs/roadmap.md): Current foundation and planned work; planned features are not compatibility promises.
