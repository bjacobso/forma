/** Read-only compiler inspection. Shapes and annotations belong to this engine. */
import { Effect, Layer, Ref } from "effect";
import * as Reader from "../Reader.js";
import * as Type from "../Type.js";
import { lowerProgram, resetNodeIds, type CoreExpr } from "../CoreExpr.js";
import { unifiedFormProvider } from "../type/unified-form-provider.js";
import { makeOwnedInferContext } from "../type/context.js";
import { applyType } from "../type/substitution.js";
import { diagnosticFromUnknown, type Diagnostic } from "../diagnostic/diagnostic.js";
import { validateHostTypes } from "./type-policy.js";
import { typeInferOptions, type TypecheckRequest } from "./operations.js";

export interface CoreDebugResult {
  readonly sourceId: string;
  readonly core?: readonly CoreExpr[];
  readonly typedCore?: unknown;
  readonly display?: string;
  readonly diagnostics: readonly Diagnostic[];
}

export function debugCore(request: TypecheckRequest & { readonly source: string }, mode: "lowerCore" | "typecheckCore" | "typecheckCoreTyped"): CoreDebugResult {
  const sourceId = request.sourceId ?? "source";
  try {
    validateHostTypes(request, request.source);
    const options = typeInferOptions(request);
    const prelude = request.session?.coreExpressions() ?? [];
    const exprs = [...prelude, ...Effect.runSync(Reader.parseManyToSExpr(request.source))];
    const provider = unifiedFormProvider(request.source, exprs);
    resetNodeIds();
    const core = lowerProgram(exprs, provider, {macroEnv:request.session?.env});
    if (mode === "lowerCore") return { sourceId, core, diagnostics: [] };
    const ctx = Effect.runSync(makeOwnedInferContext(options));
    const types = Effect.runSync(Effect.provide(Type.inferProgramAll(core, undefined, provider, exprs), Layer.succeed(Type.InferContext, ctx)));
    const subst = Effect.runSync(Ref.get(ctx.subst));
    const nodeTypes = Effect.runSync(Ref.get(ctx.nodeTypes));
    const annotate = (value: unknown): unknown => {
      if (Array.isArray(value)) return value.map(annotate);
      if (value && typeof value === "object") {
        const obj = value as Record<string, unknown>;
        const type = typeof obj.id === "string" ? nodeTypes.get(obj.id) : undefined;
        return { ...Object.fromEntries(Object.entries(obj).map(([key, child]) => [key, annotate(child)])), ...(type ? { inferredType: Type.showType(applyType(subst, type)) } : {}) };
      }
      return value;
    };
    const diagnostics = Effect.runSync(Ref.get(ctx.diagnostics)).map(d => ({code: "typecheck/diagnostic", phase: "typecheck" as const, severity: d.severity, message: d.message, ...(d.span ? {span: {sourceId, startOffset:d.span.start, endOffset:d.span.end}} : {})}));
    return { sourceId, display: Type.showType(types.at(-1) ?? Type.tNil), diagnostics, ...(mode === "typecheckCoreTyped" ? { typedCore: annotate(core) } : {}) };
  } catch (error) {
    return { sourceId, diagnostics: [diagnosticFromUnknown(error, "typecheck", sourceId)] };
  }
}

export const lowerCore = (request: TypecheckRequest & {readonly source:string}) => debugCore(request, "lowerCore");
export const typecheckCore = (request: TypecheckRequest & {readonly source:string}) => debugCore(request, "typecheckCore");
export const typecheckCoreTyped = (request: TypecheckRequest & {readonly source:string}) => debugCore(request, "typecheckCoreTyped");
