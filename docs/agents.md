# Forma

> Forma is a pre-alpha typed, homoiconic Lisp for building domain-specific languages and portable artifacts. Install the TypeScript engine with `pnpm add @formalang/ts`, or try the browser playground at https://forma-lang.com/playground.

APIs, package boundaries, syntax, and artifact formats are still evolving.
The TypeScript host includes a source-built `forma` JSON CLI and daemon, with
filesystem module commands described in [File modules](https://forma-lang.com/modules).
The TypeScript engine is the only implementation; it also powers the browser
tools, language server, and workbench. The earlier OCaml engine was removed.
Conformance fixtures and reviewed stored goldens pin implemented behavior.
The TypeScript engine distinguishes Int and Float, including integral Float
literals and results; Int arithmetic checks the JavaScript safe integer range.
Source formatting is implemented for `.lisp`, `.forma`, and Markdown `lisp`/`forma`
fences through `@formalang/ts/format`, `forma fmt`, the host JSON `format` operation,
and editor commands. LSP document and range formatting are enabled by default.
Formatting preserves authored token spellings and comments. Invalid Lisp stays
unchanged; fragment fences and unsupported containers are skipped and reported.
The structural workbench currently depends on unpublished Foldworks packages.

## Getting started

- [Quick start](https://raw.githubusercontent.com/bjacobso/forma/main/README.md): Setup, examples, package layout, and current project status.
- [TypeScript engine](https://raw.githubusercontent.com/bjacobso/forma/main/packages/ts/README.md): Embedding the reader, evaluator, typechecker, VM, and elaborator.
- [Language guide](https://raw.githubusercontent.com/bjacobso/forma/main/docs/language.md): Syntax, values, types, macros, effects, and elaboration.
- [File modules](https://raw.githubusercontent.com/bjacobso/forma/main/docs/modules.md): Explicit imports, exports, compile-time form libraries, and project preludes.

## For agents

- [Writing a form](https://raw.githubusercontent.com/bjacobso/forma/main/docs/writing-a-form.md): Define domain vocabulary with preludes, descriptors, and elaboration hooks.
- [Architecture](https://raw.githubusercontent.com/bjacobso/forma/main/docs/architecture.md): Engine boundary, host ABI and JSON CLI, artifacts, and conformance goldens.
- [Forma for Effect](https://raw.githubusercontent.com/bjacobso/forma/main/docs/effect.md): Generate Effect TypeScript from checked Forma declarations and programs.
- [Forma for Elm-style apps](https://raw.githubusercontent.com/bjacobso/forma/main/docs/elm.md): Foldkit prototype with exhaustive update, checked command recovery, and pure views; shared HttpApi client generation remains proposed.
- [Elm prototype reference](https://raw.githubusercontent.com/bjacobso/forma/main/docs/elm/reference.md): Isolated prelude generator, supported forms, mounting, and current limits.
- [Effect reference](https://raw.githubusercontent.com/bjacobso/forma/main/docs/effect/reference.md): Supported schemas, services, errors, resources, and operations.
- [Language services](https://raw.githubusercontent.com/bjacobso/forma/main/docs/language-services.md): Analysis, lossless source formatting, node identity, observations, and structural edit scripts.

## Optional

- [Workbench](https://raw.githubusercontent.com/bjacobso/forma/main/packages/workbench/README.md): Structural editing, reviewable proposals, capability approvals, setup, and first-release limits.
- [Conformance](https://raw.githubusercontent.com/bjacobso/forma/main/conformance/README.md): Fixtures and stored goldens that pin implemented engine behavior.
- [Retiring the OCaml engine](https://raw.githubusercontent.com/bjacobso/forma/main/docs/engine-consolidation.md): Why TypeScript is the only engine, the 2026-10-06 engine benchmarks, and remaining performance follow-ups.
- [Roadmap](https://raw.githubusercontent.com/bjacobso/forma/main/docs/roadmap.md): Current foundation and planned work; planned features are not compatibility promises.
- [Record row rollout](https://raw.githubusercontent.com/bjacobso/forma/main/docs/rfcs/0005-row-operations.md): Implemented closed-record operations and links to proposed generic constraints, normalization, typed reflection, and bounded row mapping.
