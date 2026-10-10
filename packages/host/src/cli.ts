#!/usr/bin/env node
/** Node transports; compiler and session behavior stays in FormaHost. */
import { readFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { readModuleGraph } from "@formalang/ts/node";
import { ModuleError, moduleMechanicsDeclarations } from "@formalang/ts/modules";
import { JsonAbi, type JsonResponse } from "./json-abi.js";

const abi = new JsonAbi();
const print = (response: JsonResponse) => process.stdout.write(JSON.stringify(response) + "\n");
const [command, ...args] = process.argv.slice(2);
async function file(operation: string, path: string): Promise<JsonResponse> {
  const graph = readModuleGraph(path);
  const opened = await abi.handleJson('{"op":"openSession"}');
  if (!opened.ok) return opened;
  const { sessionId } = opened.value as {sessionId:string};
  try {
    const loaded = await abi.host.loadSourceBundle({ sessionId, sources: graph.modules.map(m => ({ kind: "source", sourceId: m.id, source: m.source })) });
    if (loaded.diagnostics.some(d => d.severity === "error")) return {ok:false, diagnostics:loaded.diagnostics};
    const request = { sessionId, sourceId: graph.entry };
    if (operation === "typecheck") return await abi.handleJson(JSON.stringify({ op: "typecheck", ...request }));
    if (operation === "evaluate") return await abi.handleJson(JSON.stringify({ op: "evaluateInSession", ...request }));
    if (operation === "interface") return await abi.handleJson(JSON.stringify({ op: "moduleGraph", ...request }));
    const result = moduleMechanicsDeclarations(graph);
    return { ok: !result.diagnostics.some(d => d.severity === "error"), value: result.declarations, diagnostics: result.diagnostics };
  } finally { await abi.handleJson(JSON.stringify({op:"closeSession",sessionId})); }
}

try {
  if (command === "request" && args.length <= 1) print(await abi.handleJson(args[0] ?? readFileSync(0, "utf8")));
  else if (command === "daemon" && args.length === 0) {
    for await (const line of createInterface({input:process.stdin, crlfDelay:Infinity})) print(await abi.handleJson(line));
  } else if (command === "version" && args.length === 0) print(await abi.handleJson('{"op":"version"}'));
  else if (command === "file" && args.length === 2 && ["typecheck", "evaluate", "interface", "declarations"].includes(args[0]!)) print(await file(args[0]!, args[1]!));
  else {
    process.stderr.write("Usage: forma request ['<json>'] | daemon | file <typecheck|evaluate|interface|declarations> <entry.forma> | version\n");
    process.exitCode = 64;
  }
} catch (error) {
  print({ ok: false, diagnostics: error instanceof ModuleError ? [error.diagnostic] : [{ code: (error as NodeJS.ErrnoException).code ? "io/error" : "internal/error", severity: "error", message: String(error) }] });
  process.exitCode = 1;
}
