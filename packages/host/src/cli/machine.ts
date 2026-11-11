import { readFileSync } from "node:fs";
import { createInterface } from "node:readline";
import type { JsonAbi } from "../json-abi.js";
import { file } from "./file.js";
import { schemaBuild } from "./schema.js";
import { packages } from "./packages.js";
import { located, printJson } from "./output.js";

export async function machine(abi: JsonAbi, command: string, args: readonly string[]): Promise<boolean> {
  if (command === "request" && args.length <= 1) printJson(await abi.handleJson(args[0] ?? readFileSync(0, "utf8")));
  else if (command === "daemon" && args.length === 0) {
    for await (const line of createInterface({ input: process.stdin, crlfDelay: Infinity })) printJson(await abi.handleJson(line));
  } else if (command === "version" && args.length === 0) printJson(await abi.handleJson('{"op":"version"}'));
  else if (command === "file") {
    const unchecked = args.length === 3 && args[0] === "evaluate" && args[1] === "--unchecked";
    if (!unchecked && !(args.length === 2 && ["typecheck", "evaluate", "interface", "declarations"].includes(args[0]!))) return false;
    const result = await file(abi, args[0]!, args[unchecked ? 2 : 1]!, unchecked);
    printJson(located(result));
    if (!result.ok) process.exitCode = 1;
  } else if (command === "schema") {
    const result = schemaBuild(args);
    printJson(result);
    if (!result.ok) process.exitCode = 1;
  } else {
    const result = await packages(command, args);
    if (!result) return false;
    printJson(result);
  }
  return true;
}
