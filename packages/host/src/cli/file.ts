import { readModuleGraph, readNodePackages } from "@formalang/ts/node";
import { moduleMechanicsDeclarations, type ModuleGraph } from "@formalang/ts/modules";
import { isKFloat, isKKeyword, isKSymbol, mapKeyValue, type KValue } from "@formalang/ts/evaluator";
import { JsonAbi, type JsonResponse } from "../json-abi.js";
import { authorNames } from "../diagnostic-locations.js";

/** Plain JSON for elaborated IR: records become objects keyed without the leading ':'. */
function plain(value: KValue): unknown {
  if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value;
  if (isKFloat(value)) return Number.isFinite(value.value) ? value.value : String(value.value);
  if (isKSymbol(value)) return authorNames(value.name);
  if (isKKeyword(value)) return value.name;
  if (Array.isArray(value)) return value.map(plain);
  if (value instanceof Map)
    return Object.fromEntries([...value].map(([key, v]) => [String(mapKeyValue(key)).replace(/^:/, ""), plain(v)]));
  return String(value);
}

/** Each module's form applications, after the mechanics declarations. */
function formApplications(graph: ModuleGraph) {
  return graph.modules.flatMap((module) =>
    (module.compileTime?.elaborated() ?? []).map((application) => ({
      summary: {
        kind: "FormApplication",
        form: application.form,
        ...(application.name ? { name: application.name } : {}),
        moduleId: module.id,
      },
      payload: plain(application.ir),
      span: application.span,
    })),
  );
}

export async function file(abi: JsonAbi, operation: string, path: string, unchecked = false): Promise<JsonResponse> {
  const graph = readModuleGraph(path);
  const packages = readNodePackages(path);
  const opened = await abi.handleJson('{"op":"openSession"}');
  if (!opened.ok) return opened;
  const { sessionId } = opened.value as {sessionId:string};
  try {
    if (packages) await abi.host.configureSession({ sessionId, packages: packages.table });
    const loaded = await abi.host.loadSourceBundle({ sessionId, sources: graph.modules.map(m => ({ kind: "source", sourceId: m.id, source: m.source })) });
    if (loaded.diagnostics.some(d => d.severity === "error")) return {ok:false, diagnostics:loaded.diagnostics};
    const request = { sessionId, sourceId: graph.entry };
    if (operation === "typecheck") return await abi.handleJson(JSON.stringify({ op: "typecheck", ...request }));
    if (operation === "evaluate") {
      // Evaluation does not typecheck by itself; an ill-typed program is not run.
      if (!unchecked) {
        const checked = await abi.handleJson(JSON.stringify({ op: "typecheck", ...request }));
        if (!checked.ok) return checked;
      }
      return await abi.handleJson(JSON.stringify({ op: "evaluateInSession", ...request }));
    }
    if (operation === "interface") return await abi.handleJson(JSON.stringify({ op: "moduleGraph", ...request }));
    const result = moduleMechanicsDeclarations(graph);
    const ok = !result.diagnostics.some(d => d.severity === "error");
    return { ok, value: ok ? [...result.declarations, ...formApplications(graph)] : result.declarations, diagnostics: result.diagnostics };
  } finally { await abi.handleJson(JSON.stringify({op:"closeSession",sessionId})); }
}

