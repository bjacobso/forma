#!/usr/bin/env node
/** Node transports; compiler and session behavior stays in FormaHost. */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { managePackages, readModuleGraph, readNodePackages, verifyPackages } from "@formalang/ts/node";
import { ModuleError, moduleMechanicsDeclarations, type ModuleGraph } from "@formalang/ts/modules";
import { isKFloat, isKKeyword, isKSymbol, mapKeyValue, type KValue } from "@formalang/ts/evaluator";
import { authorNames, diagnosticCatalog } from "@formalang/ts/diagnostic";
import { generateTypeSchemas } from "@formalang/ts/mechanics";
import { JsonAbi, type JsonResponse } from "./json-abi.js";

const abi = new JsonAbi();
const print = (response: JsonResponse) => {
  if (command === "file" && response.value && typeof response.value === "object" && !Array.isArray(response.value)) {
    const { diagnostics: _diagnostics, ...value } = response.value as Record<string, unknown>;
    if (value.result && typeof value.result === "object" && !Array.isArray(value.result)) {
      const { diagnostics: _resultDiagnostics, ...result } = value.result as Record<string, unknown>;
      value.result = result;
    }
    response = { ...response, value };
  }
  process.stdout.write(JSON.stringify(response) + "\n");
  // A file command that reports errors fails the process, so scripts can rely on it.
  if (command === "file" && !response.ok) process.exitCode = 1;
};
const [command, ...args] = process.argv.slice(2);
const usage = `Usage: forma <command>

  file typecheck <entry.lisp>           Typecheck a module graph.
  file evaluate [--unchecked] <entry.lisp>
                                        Typecheck, then evaluate the entry's final expressions.
                                        --unchecked skips the typecheck.
  file declarations <entry.lisp>        Elaborate forms and list declarations, including
                                        each form application's IR (kind FormApplication).
  file interface <entry.lisp>           Print the module graph's interfaces.
  schema <sources...> --out <dir> [--check]
                                        Generate data codecs, types, and JSON Schema.
                                        --check fails on missing or stale output without writing.
  request ['<json>']                    Handle one JSON request (argument or stdin).
  daemon                                Handle one JSON request per stdin line.
  add <name> <spec> | update [name] | verify | vendor
                                        Manage packages.
  version                               Print the version.
  explain <code>                        Explain a diagnostic offline.
  help                                  Print this help.

Every command prints one JSON object per response with "ok" and "diagnostics".
File commands exit with status 1 when "ok" is false.
`;

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

async function file(operation: string, path: string, unchecked = false): Promise<JsonResponse> {
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

function schemaBuild(args: readonly string[]): JsonResponse {
  const paths: string[] = [];
  let out: string | undefined, check = false;
  for (let index = 0; index < args.length; index++) {
    const arg = args[index]!;
    if (arg === "--check") check = true;
    else if (arg === "--out" && args[index + 1] && !args[index + 1]!.startsWith("--")) out = args[++index];
    else if (arg.startsWith("-")) throw new Error(`Unknown schema option ${arg}`);
    else paths.push(arg);
  }
  if (!out || !paths.length) throw new Error("schema requires sources and --out <dir>");
  const result = generateTypeSchemas(paths.map(path => ({sourceId:resolve(path),source:readFileSync(path,"utf8")})));
  if (!result.ok) return {ok:false,diagnostics:[...result.diagnostics]};
  const files = Object.entries(result.files).map(([name,text]) => ({path:join(out!,name),text}));
  if (check) {
    const diagnostics = files.filter(file => !existsSync(file.path) || readFileSync(file.path,"utf8") !== file.text)
      .map(file => ({code:"schema/stale",severity:"error" as const,message:`${file.path} is missing or stale; rerun forma schema without --check.`}));
    return {ok:diagnostics.length === 0,value:{files:files.map(file => file.path)},diagnostics};
  }
  mkdirSync(out,{recursive:true});
  for (const file of files) writeFileSync(file.path,file.text);
  return {ok:true,value:{files:files.map(file => file.path)},diagnostics:[]};
}

try {
  if (command === "request" && args.length <= 1) print(await abi.handleJson(args[0] ?? readFileSync(0, "utf8")));
  else if (command === "daemon" && args.length === 0) {
    for await (const line of createInterface({input:process.stdin, crlfDelay:Infinity})) print(await abi.handleJson(line));
  } else if (command === "version" && args.length === 0) print(await abi.handleJson('{"op":"version"}'));
  else if (command === "explain" && args.length === 1) {
    const entry = diagnosticCatalog.get(args[0]!);
    if (entry) print({ok:true,value:entry,diagnostics:[]});
    else {
      print({ok:false,diagnostics:[{code:"abi/unknown-code",severity:"error",message:`Unknown diagnostic code ${args[0]}`,details:{name:args[0]}}]});
      process.exitCode = 1;
    }
  }
  else if (command === "help" || command === "--help" || command === "-h" || (args.length === 1 && (args[0] === "--help" || args[0] === "-h"))) process.stdout.write(usage);
  else if (command === "file" && args.length === 3 && args[0] === "evaluate" && args[1] === "--unchecked") print(await file("evaluate", args[2]!, true));
  else if (command === "file" && args.length === 2 && ["typecheck", "evaluate", "interface", "declarations"].includes(args[0]!)) print(await file(args[0]!, args[1]!));
  else if (command === "schema") {
    const result = schemaBuild(args);
    print(result);
    if (!result.ok) process.exitCode = 1;
  }
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
    process.stderr.write(usage);
    process.exitCode = 64;
  }
} catch (error) {
  print({ ok: false, diagnostics: error instanceof ModuleError ? [...error.diagnostics] : [{ code: (error as NodeJS.ErrnoException).code ? "io/error" : "internal/error", severity: "error", message: String(error) }] });
  process.exitCode = 1;
}
