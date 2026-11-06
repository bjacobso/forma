import { bootstrapFromSources, elaborateProgram } from "@formalang/ts/descriptor";
import { parse } from "@formalang/ts/engine";
import { formatSExpr } from "@formalang/ts/formatter";
import type { RunRequest, RunResult } from "./protocol";

export function compilePreludeDemo(request: RunRequest): RunResult {
  const started = performance.now();
  const preludeSyntax = parse({ sourceId: "prelude.forma", source: request.prelude ?? "" });
  const parsed = parse({ sourceId: request.sourceId, source: request.source });
  const parsedAt = performance.now();
  const parseDiagnostics = [...preludeSyntax.diagnostics, ...parsed.diagnostics];
  if (parseDiagnostics.some(d => d.severity === "error")) return {
    id: request.id, sourceId: request.sourceId,
    passResults: [{ ...parsed, durationMs: parsedAt - started }],
    diagnostics: parseDiagnostics, declarations: [], stoppedAt: "parse",
    preludeDebug: { preludeSyntax, forms: [], declarations: [], timings: [{ phase: "Read", durationMs: parsedAt - started }] },
  };
  const prelude = bootstrapFromSources("", request.prelude ?? "");
  const bootstrappedAt = performance.now();
  const result = elaborateProgram(request.source, { prelude, sourceId: request.sourceId });
  return {
    id: request.id,
    sourceId: request.sourceId,
    passResults: [{ ...parsed, durationMs: parsedAt - started }],
    diagnostics: result.diagnostics,
    declarations: result.declarations.map(declaration => declaration.payload),
    preludeDebug: {
      preludeSyntax,
      forms: prelude.descriptions.list().map(form => ({ name: form.name, definition: {
        ...(form.surface ? {
          pattern: `(${[form.name, ...form.surface.pattern.map(expr => formatSExpr(expr))].join(" ")})`,
          holes: Object.fromEntries([...form.surface.holes].map(([name, type]) => [name, formatSExpr(type)])),
          ir: form.surface.ir ? formatSExpr(form.surface.ir) : undefined,
        } : {}),
        identifiers: form.identifiers, slots: form.slots, produces: form.produces,
        resultType: form.resultType, doc: form.doc,
      } })),
      declarations: result.declarations.map(declaration => ({
        name: declaration.summary.name ?? declaration.formName,
        resultType: declaration.summary.resultType,
        origin: declaration.origin, sourceMap: declaration.sourceMap,
      })),
      timings: [
        { phase: "Read", durationMs: parsedAt - started },
        { phase: "Load prelude", durationMs: bootstrappedAt - parsedAt },
        { phase: "Elaborate", durationMs: performance.now() - bootstrappedAt },
      ],
    },
  };
}
