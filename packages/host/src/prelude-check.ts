import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { checkPrelude } from "@formalang/ts/preludes";
import { DiagnosticCatalog, type DiagnosticCatalogEntry } from "@formalang/ts/diagnostic";
import type { JsonResponse } from "./json-abi.js";

export function preludeCheck(args: readonly string[]): JsonResponse {
  const paths: string[] = [], dependencies: string[] = [];
  let out: string | undefined, catalogPath: string | undefined;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (["--out","--catalog","--dependency"].includes(arg)) {
      const value = args[++i];
      if (!value || value.startsWith("--")) throw new Error(`${arg} needs a path`);
      if (arg === "--out") out = value;
      else if (arg === "--catalog") catalogPath = value;
      else dependencies.push(value);
    } else if (arg.startsWith("-")) throw new Error(`Unknown prelude check option ${arg}`);
    else paths.push(arg);
  }
  if (!paths.length) throw new Error("prelude check requires at least one source");
  const catalog = new DiagnosticCatalog();
  if (catalogPath) {
    const entries: readonly DiagnosticCatalogEntry[] = JSON.parse(readFileSync(catalogPath,"utf8"));
    if (!Array.isArray(entries)) throw new Error("--catalog requires a JSON array of diagnostic entries");
    for (const entry of entries) {
      if (!["stable","unstable","internal"].includes(entry.stability)) throw new Error("Invalid diagnostic stability");
      catalog.register(entry);
    }
  }
  const read = (path: string) => ({sourceId:resolve(path),source:readFileSync(path,"utf8")});
  const result = checkPrelude(paths.map(read),{dependencies:dependencies.map(read),catalog});
  if (result.ok && out) {
    mkdirSync(dirname(resolve(out)),{recursive:true});
    writeFileSync(out,result.reference);
  }
  return {ok:result.ok,value:{forms:result.forms,examples:result.examples,...out ? {referencePath:resolve(out)} : {reference:result.reference}},diagnostics:[...result.diagnostics]};
}
