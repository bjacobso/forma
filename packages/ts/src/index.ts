/**
 * @formalang/ts
 *
 * Lisp infrastructure v2: pipeline-oriented architecture.
 *
 * Subpath exports:
 * - `@formalang/ts/reader`       — S-expression parser
 * - `@formalang/ts/source`       — Source identity and provenance
 * - `@formalang/ts/session`      — Loaded source/session state
 * - `@formalang/ts/engine`       — Engine-owned host operations
 * - `@formalang/ts/artifact`     — Validated artifact packaging
 * - `@formalang/ts/mechanics`    — Mechanics artifacts + hosted runtime
 * - `@formalang/ts/sexpr`        — Core AST types
 * - `@formalang/ts/evaluator`    — Direct interpreter
 * - `@formalang/ts/expander`     — Macro expansion
 * - `@formalang/ts/vm`           — Bytecode compiler + executor
 * - `@formalang/ts/builtins`     — Primitive operations
 * - `@formalang/ts/type`         — Hindley-Milner type system
 * - `@formalang/ts/core-expr`    — Typed core expression AST
 * - `@formalang/ts/elaboration`  — DSL handler framework
 * - `@formalang/ts/form`         — Form/pattern/compiler framework
 * - `@formalang/ts/env`          — Value environment
 * - `@formalang/ts/diagnostic`   — Errors and diagnostics
 * - `@formalang/ts/formatter`    — Code formatter
 * - `@formalang/ts/editor`       — Structural editing
 * - `@formalang/ts/lsp`          — Language server support
 * - `@formalang/ts/codegen`      — S-expression builder for code gen
 * - `@formalang/ts/descriptor-codegen` — FormDescriptor → Effect Schema source generation
 * - `@formalang/ts/descriptor`   — Self-describing form system + bootstrap
 */

export * as SExpr from "./SExpr.js";
export * as Reader from "./Reader.js";
export * as Source from "./Source.js";
export * as Session from "./Session.js";
export * as Engine from "./Engine.js";
export * as Artifact from "./Artifact.js";
export * as Mechanics from "./Mechanics.js";
export * as Evaluator from "./Evaluator.js";
export * as Expander from "./Expander.js";
export * as VM from "./VM.js";
export * as Builtins from "./Builtins.js";
export * as Type from "./Type.js";
export * as CoreExpr from "./CoreExpr.js";
export * as Elaboration from "./Elaboration.js";
export * as Form from "./Form.js";
export * as Env from "./Env.js";
export * as Diagnostic from "./Diagnostic.js";
export * as Formatter from "./Formatter.js";
export * as Editor from "./Editor.js";
export * as LSP from "./LSP.js";
export * as CodeGen from "./CodeGen.js";
export * as DescriptorCodegen from "./DescriptorCodegen.js";
export * as Descriptor from "./Descriptor.js";
