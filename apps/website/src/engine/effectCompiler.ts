import { parse, typeProjection, type ExpressionType } from "@formalang/ts/engine";
import { generateEffectProgram, showMechanicsType } from "@formalang/ts/mechanics";
import type { Diagnostic, RunRequest, RunResult } from "./protocol";

/** One checker result drives diagnostics, body inference, IR, and generated code. */
export function compileEffectDemo(request: RunRequest): RunResult {
  const started = performance.now();
  const parsed = parse({ sourceId: request.sourceId, source: request.source });
  const readMs = performance.now() - started;
  const result = generateEffectProgram(request.source, { sourceId: request.sourceId });
  const diagnostics: Diagnostic[] = result.diagnostics.map(diagnostic => ({
    ...diagnostic,
    phase: diagnostic.phase === "read" ? "parse" : diagnostic.phase === "project" ? "elaborate" : "typecheck",
  }));
  const expressionTypes: ExpressionType[] = [];
  const contracts: NonNullable<RunResult["contracts"]>[number][] = [];
  const check = result.check;
  if (check) {
    for (const declaration of result.declarations) {
      const payload = declaration.payload;
      if (!payload || typeof payload !== "object" || Array.isArray(payload)) continue;
      const name = declaration.summary.name;
      const signature = name ? check.operations.get(name) ?? check.functions.get(name) : undefined;
      const body = (payload as { readonly body?: unknown }).body;
      if (name && signature && body && typeof body === "object") {
        const actual = check.effectTypes.get(body) ?? check.valueTypes.get(body);
        contracts.push({
          name,
          declared: showMechanicsType({ kind: "function", params: signature.params.map(param => param.type), result: signature.result }),
          inferred: actual ? showMechanicsType(actual) : "Unavailable",
        });
      }
      const visit = (node: unknown): void => {
        if (!node || typeof node !== "object") return;
        const type = check.effectTypes.get(node) ?? check.valueTypes.get(node);
        const span = (node as { span?: { sourceId: string; startOffset: number; endOffset: number } }).span;
        if (type && span) expressionTypes.push({
          expressionId: `effect-${expressionTypes.length}`,
          formIndex: declaration.formIndex,
          display: showMechanicsType(type),
          type: typeProjection(showMechanicsType(type)),
          span,
        });
        for (const value of Object.values(node)) visit(value);
      };
      visit(payload);
    }
  }
  const readErrors = diagnostics.filter(d => d.phase === "parse");
  return {
    id: request.id,
    sourceId: request.sourceId,
    diagnostics,
    passResults: [
      { ...parsed, diagnostics: readErrors, durationMs: readMs },
      ...(readErrors.length ? [] : [{
        pass: "typecheck" as const,
        sourceId: request.sourceId,
        diagnostics,
        display: contracts.map(contract => `${contract.name}: ${contract.inferred}`).join("\n") || "Declarations checked",
        expressionTypes,
        durationMs: performance.now() - started - readMs,
      }]),
    ],
    ...(result.ok ? {} : { stoppedAt: readErrors.length ? "parse" as const : "typecheck" as const }),
    ...(result.code ? { generatedCode: result.code } : {}),
    declarations: result.declarations,
    contracts,
  };
}
