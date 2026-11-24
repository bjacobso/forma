import { readFileSync, writeFileSync } from "node:fs";
import { readModuleGraph, readNodePackages, type NodePackages } from "@formalang/ts/node";
import { moduleMechanicsDeclarations, type ModuleGraph } from "@formalang/ts/modules";
import { isKFloat, isKKeyword, isKSymbol, mapKeyValue, type KValue } from "@formalang/ts/evaluator";
import { JsonAbi, type JsonResponse } from "../json-abi.js";
import { authorNames } from "@formalang/ts/diagnostic";
import { parseJournalJsonl, serializeJournalJsonl, type HostCallJournal, type JournalRequest } from "../journal.js";
import type { EvaluationState } from "../types.js";

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

export interface FileRunOptions {
  readonly unchecked?: boolean | undefined;
  readonly recordPath?: string | undefined;
  readonly replayPath?: string | undefined;
  readonly allowProgramMismatch?: boolean | undefined;
}

export async function file(
  abi: JsonAbi,
  operation: string,
  path: string,
  uncheckedOrOptions: boolean | FileRunOptions = false,
): Promise<JsonResponse> {
  const options: FileRunOptions =
    typeof uncheckedOrOptions === "boolean" ? { unchecked: uncheckedOrOptions } : uncheckedOrOptions;
  const unchecked = options.unchecked === true;
  let replayJournal: HostCallJournal | undefined;
  if (operation === "evaluate" && options.replayPath !== undefined) {
    try {
      replayJournal = parseJournalJsonl(readFileSync(options.replayPath, "utf8"));
    } catch (error) {
      return {
        ok: false,
        diagnostics: [
          {
            code: "journal/invalid",
            severity: "error",
            message: error instanceof Error ? error.message : String(error),
            phase: "evaluate",
          },
        ],
      };
    }
  }
  const graph = readModuleGraph(path);
  const packages = readNodePackages(path);
  return withFileSession(abi, graph, packages, async (sessionId) => {
    const request = { sessionId, sourceId: graph.entry };
    if (operation === "typecheck") return await abi.handleJson(JSON.stringify({ op: "typecheck", ...request }));
    if (operation === "evaluate") {
      if (replayJournal && replayJournal.header.builtins.length > 0) {
        await abi.host.configureSession({
          sessionId,
          hostBuiltins: replayJournal.header.builtins.map((b) => ({
            name: b.name,
            arity: { min: 0 },
            typeScheme: { kind: "variadic-function", params: [], rest: { kind: "any" }, result: { kind: "any" } },
            handler: { kind: "host-effect", effect: b.effect },
          })),
        });
      }
      // Evaluation does not typecheck by itself; an ill-typed program is not run.
      if (!unchecked) {
        const checked = await abi.handleJson(JSON.stringify({ op: "typecheck", ...request }));
        if (!checked.ok) return checked;
      }
      const journal: JournalRequest | undefined = replayJournal
        ? {
            mode: "replay",
            journal: replayJournal,
            ...(options.allowProgramMismatch ? { allowProgramMismatch: true } : {}),
            ...(options.recordPath ? { record: true } : {}),
          }
        : options.recordPath
          ? { mode: "record" }
          : undefined;
      const response = await abi.handleJson(
        JSON.stringify({ op: "evaluateInSession", ...request, ...(journal ? { journal } : {}) }),
      );
      if (options.recordPath && response.value && typeof response.value === "object") {
        const state = response.value as EvaluationState;
        if ((state.status === "completed" || state.status === "failed") && state.journal) {
          writeFileSync(options.recordPath, serializeJournalJsonl(state.journal), "utf8");
        }
      }
      return response;
    }
    if (operation === "interface") return await abi.handleJson(JSON.stringify({ op: "moduleGraph", ...request }));
    const result = moduleMechanicsDeclarations(graph);
    const ok = !result.diagnostics.some(d => d.severity === "error");
    return { ok, value: ok ? [...result.declarations, ...formApplications(graph)] : result.declarations, diagnostics: result.diagnostics };
  });
}

/** Share module loading and guaranteed session cleanup across CLI transports. */
export async function withFileSession<T>(abi: JsonAbi, graph: ModuleGraph, packages: NodePackages | undefined, action: (sessionId: string) => Promise<T>): Promise<T | JsonResponse> {
  const opened = await abi.handleJson('{"op":"openSession"}');
  if (!opened.ok) return opened;
  const { sessionId } = opened.value as {sessionId:string};
  try {
    if (packages) await abi.host.configureSession({ sessionId, packages: packages.table });
    const loaded = await abi.host.loadSourceBundle({ sessionId, sources: graph.modules.map(m => ({ kind: "source", sourceId: m.id, source: m.source })) });
    if (loaded.diagnostics.some(d => d.severity === "error")) return {ok:false, diagnostics:loaded.diagnostics};
    return await action(sessionId);
  } finally { await abi.handleJson(JSON.stringify({op:"closeSession",sessionId})); }
}

