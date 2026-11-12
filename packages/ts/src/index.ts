/**
 * Forma's TypeScript/Effect language engine: reading, expansion, checking,
 * evaluation, elaboration, artifacts, and UI-free language services.
 *
 * This root exposes namespaces. See package.json for the complete subpath
 * export map, including bundled preludes and Node-only filesystem helpers
 * that are available separately from this root.
 */

export * as SExpr from "./SExpr.js";
export * as Reader from "./Reader.js";
export * as Modules from "./Modules.js";
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
export * as Env from "./Env.js";
export * as Diagnostic from "./Diagnostic.js";
export * as Formatter from "./Formatter.js";
export * as Editor from "./Editor.js";
export * as Analysis from "./Analysis.js";
export * as Syntax from "./Syntax.js";
export * as LSP from "./LSP.js";
export * as CodeGen from "./CodeGen.js";
export * as DescriptorCodegen from "./DescriptorCodegen.js";
export * as HttpApi from "./HttpApi.js";
export * as Descriptor from "./Descriptor.js";
