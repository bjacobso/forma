# Forma

> Forma is a pre-alpha programmable type system for Lisp: a typed, homoiconic Lisp whose preludes define typed forms for domain-specific languages and portable artifacts. Install the public package with `npm install @forma-language/forma effect`, or try the browser playground at https://forma-lang.com/playground.

Forma source files use `.lisp`; project metadata uses `forma.json` and `forma.lock`.

APIs, package boundaries, syntax, and artifact formats are still evolving.
The TypeScript host includes a source-built `forma` CLI (check, run, test, fmt, repl, explain, describe, mcp, and JSON commands) and daemon, with
filesystem module commands described in [File modules](https://forma-lang.com/modules).
The TypeScript engine is the only implementation; it also powers the browser
tools and language server. The earlier OCaml engine was removed.
Conformance fixtures and reviewed stored goldens pin implemented behavior.
The TypeScript engine distinguishes Int and Float, including integral Float
literals and results; Int arithmetic checks the JavaScript safe integer range.
Effect generation, canonical artifact validation, host/CLI checks, and workspace
analysis share mechanics semantic checks for supported explicit Effect
declarations. Low-level HM inference remains separate; language-server file
import resolution and complete mechanics editor parity are unfinished.
A fresh clone uses
`pnpm install --frozen-lockfile` without a sibling checkout or link step.

## Getting started

- [Core cheat sheet](https://raw.githubusercontent.com/bjacobso/forma/main/docs/cheatsheet.md): Checked syntax, types, modules, forms, effects, builtin signatures, and fixes for common diagnostics.
- [Embedding](https://forma-lang.com/embedding): Experimental promise-based host facade for checking, running, capabilities, form discovery, and canonical IR emission without Effect imports.
- [Authoring](https://raw.githubusercontent.com/bjacobso/forma/main/docs/authoring.md): Install from source before publication, check and run a first file, then use file modules, typed forms, diagnostics, formatting, and the REPL. Links to runnable project and Node embedding examples.
- [Quick start](https://raw.githubusercontent.com/bjacobso/forma/main/README.md): Setup, examples, package layout, and current project status.
- [TypeScript engine](https://raw.githubusercontent.com/bjacobso/forma/main/packages/ts/README.md): Embedding the reader, evaluator, typechecker, VM, and elaborator.
- [Language guide](https://raw.githubusercontent.com/bjacobso/forma/main/docs/language.md): Syntax, values, types, macros, effects, and elaboration.
- [Structure and Interpretation of Forma Programs](https://raw.githubusercontent.com/bjacobso/forma/main/docs/structure-and-interpretation.md): SICP-style introduction covering functions, processes, data abstraction, symbolic data, effects, streams, an interpreter, macros, and typed forms, with examples run on the current engine.
- [Domain modeling in Forma](https://raw.githubusercontent.com/bjacobso/forma/main/docs/domain-modeling.md): A wholesale ordering workflow designed in the style of *Domain Modeling Made Functional*, with brands, refinements, tagged choices, typed errors, and service requirements, compiled to Effect TypeScript; lists current modeling limits.
- [File modules](https://raw.githubusercontent.com/bjacobso/forma/main/docs/modules.md): Explicit imports, exports, compile-time form libraries, project preludes, and offline package imports through `forma.json`, verified `forma.lock`, committed vendor sources, and explicit add/update/verify/vendor commands.

## For agents

- [MCP server](https://forma-lang.com/mcp): Configure Claude Code or Codex with structured check, run, format, diagnostic explanation, and node-addressed editing tools.

- [Writing a form](https://raw.githubusercontent.com/bjacobso/forma/main/docs/writing-a-form.md): Define domain vocabulary with typed forms, form-local constant extensions, checked documentation examples, and elaboration hooks.
- [Preludes](https://forma-lang.com/preludes/): Catalog of the repository preludes with maturity labels; each reference page is generated at site build from form descriptors, `(: name type)` signatures, docstrings, comments, and per-form examples checked by `pnpm check`.
- [Architecture](https://raw.githubusercontent.com/bjacobso/forma/main/docs/architecture.md): Engine boundary, host ABI and JSON CLI, artifacts, and conformance goldens.
- [Forma for Effect](https://raw.githubusercontent.com/bjacobso/forma/main/docs/effect.md): Generate Effect TypeScript from checked Forma declarations and programs.
- [Prelude-defined RPC](https://raw.githubusercontent.com/bjacobso/forma/main/docs/effect/rpc.md): Unary RPC contracts and named groups emitted through a dedicated prelude to native Effect code; shared schema imports, explicit native handlers and transports, and current limits.
- [Prelude-defined Cluster entities](https://raw.githubusercontent.com/bjacobso/forma/main/docs/effect/cluster.md): Prototype Effect Cluster entities with pure, checked state transitions, required deduplication keys for persisted state-changing commands, and native `Entity.make`/`toLayer` output; in-memory state only, with runners, storage, workflows, singletons, and cron not implemented.
- [One Effect system from several preludes](https://raw.githubusercontent.com/bjacobso/forma/main/docs/effect/system.md): `generateEffectSystem` links RPC, HTTP API, and Cluster declarations with ordinary Effect forms into checked native modules plus a graph of services, operations, endpoints, RPCs, entities, and their relations. File modules select libraries through forma:effect/rpc, forma:effect/http-api, and forma:effect/cluster imports and work with plain forma check; standalone generators retain their options, and nothing consumes the graph yet.
- [Forma for Elm-style apps](https://raw.githubusercontent.com/bjacobso/forma/main/docs/elm.md): Foldkit prototype with exhaustive update, checked command recovery, and pure views; shared HttpApi client generation remains proposed.
- [Elm prototype reference](https://raw.githubusercontent.com/bjacobso/forma/main/docs/elm/reference.md): Isolated prelude generator, supported forms, mounting, and current limits.
- [Forma for email automation](https://raw.githubusercontent.com/bjacobso/forma/main/docs/email.md): Email rule prelude prototype with closed lanes, first-match decisions, pure rules, and typed delivery recovery; scheduling, rate enforcement, and dry runs are not implemented.
- [Clojure spellings](https://raw.githubusercontent.com/bjacobso/forma/main/docs/clojure.md): `preludes/modules/clojure.lisp`, a shipped macro library giving Forma modules Clojure spellings (`def`, `defn`, `if-let`, threading) over Forma semantics; keyword access, set and function literals, multi-arity `defn`, and any Clojure surface, adapter, or emitter are not implemented.
- [Effect reference](https://raw.githubusercontent.com/bjacobso/forma/main/docs/effect/reference.md): Supported schemas, services, errors, resources, and operations.
- [Language services](https://raw.githubusercontent.com/bjacobso/forma/main/docs/language-services.md): Analysis, node identity, observations, and structural edit scripts.

## Optional

- [Conformance](https://raw.githubusercontent.com/bjacobso/forma/main/conformance/README.md): Fixtures and stored goldens that pin implemented engine behavior.
- [Retiring the OCaml engine](https://raw.githubusercontent.com/bjacobso/forma/main/docs/engine-consolidation.md): Why TypeScript is the only engine, the 2026-10-06 engine benchmarks, and remaining performance follow-ups.
- [Roadmap](https://raw.githubusercontent.com/bjacobso/forma/main/docs/roadmap.md): Current foundation and planned work; planned features are not compatibility promises.
- [Record row rollout](https://raw.githubusercontent.com/bjacobso/forma/main/docs/rfcs/0005-row-operations.md): Implemented closed-record operations and links to proposed generic constraints, normalization, typed reflection, and bounded row mapping.
