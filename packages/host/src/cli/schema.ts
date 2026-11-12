import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { generateTypeSchemas } from "@formalang/ts/mechanics";
import type { JsonResponse } from "../json-abi.js";

export function schemaBuild(args: readonly string[]): JsonResponse {
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
