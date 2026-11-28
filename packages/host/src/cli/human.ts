import type { JsonAbi } from "../json-abi.js";
import type { EvaluationState } from "../types.js";
import { testFiles } from "./test.js";
import { file } from "./file.js";
import { formatFiles } from "./format.js";
import { describe } from "./describe.js";
import { explain } from "./explain.js";
import { repl } from "./repl.js";
import { storeCommand } from "./store.js";
import { displayPath, report } from "./output.js";

export async function human(abi: JsonAbi, command: string, args: readonly string[]): Promise<boolean> {
  if (command === "describe") return describe(abi, args);
  if (command === "test") return testFiles(args);
  if (command === "store") return storeCommand(args);
  const json = args.includes("--json");
  if (command === "run") {
    let unchecked = false;
    let allowProgramMismatch = false;
    let recordPath: string | undefined;
    let replayPath: string | undefined;
    const runPaths: string[] = [];
    for (let i = 0; i < args.length; i++) {
      const arg = args[i]!;
      if (arg === "--json") continue;
      if (arg === "--unchecked") { unchecked = true; continue; }
      if (arg === "--allow-program-mismatch") { allowProgramMismatch = true; continue; }
      if (arg === "--record" || arg === "--replay") {
        const next = args[i + 1];
        if (!next || next.startsWith("-")) return false;
        if (arg === "--record") recordPath = next;
        else replayPath = next;
        i++;
        continue;
      }
      if (arg.startsWith("-")) return false;
      runPaths.push(arg);
    }
    if (runPaths.length !== 1) return false;
    const response = await file(abi, "evaluate", runPaths[0]!, {
      unchecked,
      ...(recordPath ? { recordPath } : {}),
      ...(replayPath ? { replayPath } : {}),
      ...(allowProgramMismatch ? { allowProgramMismatch } : {}),
    });
    report(response, json, false);
    if (!json && response.ok) {
      const state = response.value as EvaluationState;
      if (state.status === "completed") process.stdout.write(`${state.result.printed ?? "nil"}\n`);
    }
    return true;
  }
  const paths = args.filter(arg => !arg.startsWith("-"));
  const allowed = command === "fmt" ? ["--json", "--check"] : ["--json"];
  if (command === "repl") {
    const preludes: string[] = [];
    for (let i = 0; i < args.length; i += 2) {
      if (args[i] !== "--prelude" || !args[i + 1] || args[i + 1]!.startsWith("-")) return false;
      preludes.push(args[i + 1]!);
    }
    await repl(abi, preludes);
    return true;
  }
  if (args.some(arg => arg.startsWith("-") && !allowed.includes(arg))) return false;
  if (command === "check" && paths.length === 1) {
    const response = await file(abi, "typecheck", paths[0]!, false);
    report(response, json, true);
  } else if (command === "fmt" && paths.length) {
    const response = await formatFiles(paths, args.includes("--check"));
    report(response, json, false);
    if (!json && args.includes("--check")) {
      for (const path of (response.value as { files: string[] }).files) process.stdout.write(`${displayPath(path)}\n`);
    }
  } else if (command === "explain" && paths.length === 1) explain(paths[0]!, json);
  else return false;
  return true;
}
