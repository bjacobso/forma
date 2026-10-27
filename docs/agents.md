# Forma

> Forma is a pre-alpha programmable type system for Lisp: a typed, homoiconic Lisp whose preludes define typed forms for domain-specific languages and portable artifacts. Install the TypeScript engine with `pnpm add @formalang/ts`, or try the browser playground at https://forma-lang.com/playground.

APIs, package boundaries, syntax, and artifact formats are still evolving.
The TypeScript host includes a source-built `forma` JSON CLI and daemon, with
filesystem module commands described in [File modules](https://forma-lang.com/modules).
The TypeScript engine is the only implementation; it also powers the browser
tools, language server, and the Foldworks-hosted workbench. The earlier OCaml engine was removed.
Conformance fixtures and reviewed stored goldens pin implemented behavior.
The TypeScript engine distinguishes Int and Float, including integral Float
literals and results; Int arithmetic checks the JavaScript safe integer range.
Effect generation, canonical artifact validation, host/CLI checks, and workspace
analysis share mechanics semantic checks for supported explicit Effect
declarations. Low-level HM inference remains separate; language-server file
import resolution and complete mechanics editor parity are unfinished.
Forma has no Foldworks dependencies. Foldworks owns the structural workbench
app; Forma keeps the language and UI-free language services. A fresh clone uses
`pnpm install --frozen-lockfile` without a sibling checkout or link step.

## Getting started

- [Quick start](https://raw.githubusercontent.com/bjacobso/forma/main/README.md): Setup, examples, package layout, and current project status.
- [TypeScript engine](https://raw.githubusercontent.com/bjacobso/forma/main/packages/ts/README.md): Embedding the reader, evaluator, typechecker, VM, and elaborator.
- [Language guide](https://raw.githubusercontent.com/bjacobso/forma/main/docs/language.md): Syntax, values, types, macros, effects, and elaboration.
- [Structure and Interpretation of Forma Programs](https://raw.githubusercontent.com/bjacobso/forma/main/docs/structure-and-interpretation.md): SICP-style introduction covering functions, processes, data abstraction, symbolic data, effects, streams, an interpreter, macros, and typed forms, with examples run on the current engine.
- [Domain modeling in Forma](https://raw.githubusercontent.com/bjacobso/forma/main/docs/domain-modeling.md): A wholesale ordering workflow designed in the style of *Domain Modeling Made Functional*, with brands, refinements, tagged choices, typed errors, and service requirements, compiled to Effect TypeScript; lists current modeling limits.
- [File modules](https://raw.githubusercontent.com/bjacobso/forma/main/docs/modules.md): Explicit imports, exports, compile-time form libraries, project preludes, and offline package imports through `forma.json`, verified `forma.lock`, committed vendor sources, and explicit add/update/verify/vendor commands.

## For agents

- [Writing a form](https://raw.githubusercontent.com/bjacobso/forma/main/docs/writing-a-form.md): Define domain vocabulary with preludes, descriptors, and elaboration hooks.
- [Preludes](https://forma-lang.com/preludes/): Catalog of the repository preludes with maturity labels; each reference page is generated at site build from form descriptors, `(: name type)` signatures, and doc comments.
- [Architecture](https://raw.githubusercontent.com/bjacobso/forma/main/docs/architecture.md): Engine boundary, host ABI and JSON CLI, artifacts, and conformance goldens.
- [Forma for Effect](https://raw.githubusercontent.com/bjacobso/forma/main/docs/effect.md): Generate Effect TypeScript from checked Forma declarations and programs.
- [Forma for Elm-style apps](https://raw.githubusercontent.com/bjacobso/forma/main/docs/elm.md): Foldkit prototype with exhaustive update, checked command recovery, and pure views; shared HttpApi client generation remains proposed.
- [Elm prototype reference](https://raw.githubusercontent.com/bjacobso/forma/main/docs/elm/reference.md): Isolated prelude generator, supported forms, mounting, and current limits.
- [Forma for email automation](https://raw.githubusercontent.com/bjacobso/forma/main/docs/email.md): Email rule prelude prototype with closed lanes, first-match decisions, pure rules, and typed delivery recovery; scheduling, rate enforcement, and dry runs are not implemented.
- [Effect reference](https://raw.githubusercontent.com/bjacobso/forma/main/docs/effect/reference.md): Supported schemas, services, errors, resources, and operations.
- [Language services](https://raw.githubusercontent.com/bjacobso/forma/main/docs/language-services.md): Analysis, node identity, observations, and structural edit scripts.

## Optional

- [Workbench](https://raw.githubusercontent.com/bjacobso/forma/main/docs/workbench.md): Foldworks-hosted structural editing, the language/service boundary, and current limits.
- [Conformance](https://raw.githubusercontent.com/bjacobso/forma/main/conformance/README.md): Fixtures and stored goldens that pin implemented engine behavior.
- [Retiring the OCaml engine](https://raw.githubusercontent.com/bjacobso/forma/main/docs/engine-consolidation.md): Why TypeScript is the only engine, the 2026-10-06 engine benchmarks, and remaining performance follow-ups.
- [Roadmap](https://raw.githubusercontent.com/bjacobso/forma/main/docs/roadmap.md): Current foundation and planned work; planned features are not compatibility promises.
- [Effect-Go (RFC 0019)](https://raw.githubusercontent.com/bjacobso/forma/main/docs/rfcs/0019-effect-go.md): Proposed second Effect host in Go; an isolated generator and Go runtime prototype run four conformance programs; not a supported target.
- [Record row rollout](https://raw.githubusercontent.com/bjacobso/forma/main/docs/rfcs/0005-row-operations.md): Implemented closed-record operations and links to proposed generic constraints, normalization, typed reflection, and bounded row mapping.
