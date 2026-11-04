#!/usr/bin/env node
/** Node transports; compiler and session behavior stays in FormaHost. */
import { readFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { managePackages, readModuleGraph, readNodePackages, verifyPackages } from "@formalang/ts/node";
import { ModuleError, moduleMechanicsDeclarations } from "@formalang/ts/modules";
import { JsonAbi, type JsonResponse } from "./json-abi.js";

const abi = new JsonAbi();
const print = (response: JsonResponse) => process.stdout.write(JSON.stringify(response) + "\n");
const [command, ...args] = process.argv.slice(2);
async function file(operation: string, path: string): Promise<JsonResponse> {
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
  else if (command === "verify" && args.length === 0) {
    const packages = verifyPackages();
    print({ ok: true, value: { packages: packages.table.packages.map(pkg => pkg.name) }, diagnostics: [] });
  } else if (command === "add" && args.length === 2) {
    print({ ok: true, value: await managePackages({ command: "add", name: args[0]!, source: args[1]! }), diagnostics: [] });
  } else if (command === "update" && args.length <= 1) {
    print({ ok: true, value: await managePackages({ command: "update", ...(args[0] ? { name: args[0] } : {}) }), diagnostics: [] });
  } else if (command === "vendor" && args.length === 0) {
    print({ ok: true, value: await managePackages({ command: "vendor" }), diagnostics: [] });
  } else {
    process.stderr.write("Usage: forma request ['<json>'] | daemon | file <typecheck|evaluate|interface|declarations> <entry.forma> | add <name> <spec> | update [name] | verify | vendor | version\n");
    process.exitCode = 64;
  }
} catch (error) {
  print({ ok: false, diagnostics: error instanceof ModuleError ? [error.diagnostic] : [{ code: (error as NodeJS.ErrnoException).code ? "io/error" : "internal/error", severity: "error", message: String(error) }] });
  process.exitCode = 1;
}
