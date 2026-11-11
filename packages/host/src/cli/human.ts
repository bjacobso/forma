import type { JsonAbi } from "../json-abi.js";
import type { EvaluationState } from "../types.js";
import { testFiles } from "./test.js";
import { file } from "./file.js";
import { formatFiles } from "./format.js";
import { describe } from "./describe.js";
import { explain } from "./explain.js";
import { repl } from "./repl.js";
import { displayPath, report } from "./output.js";

export async function human(abi: JsonAbi, command: string, args: readonly string[]): Promise<boolean> {
  if (command === "describe") return describe(abi, args);
  if (command === "test") return testFiles(args);
  const json = args.includes("--json");
  const paths = args.filter(arg => !arg.startsWith("-"));
  const allowed = command === "run" ? ["--json", "--unchecked"] : command === "fmt" ? ["--json", "--check"] : ["--json"];
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
  if ((command === "check" || command === "run") && paths.length === 1) {
    const response = await file(abi, command === "check" ? "typecheck" : "evaluate", paths[0]!, args.includes("--unchecked"));
    report(response, json, command === "check");
    if (command === "run" && !json && response.ok) {
      const state = response.value as EvaluationState;
      if (state.status === "completed") process.stdout.write(`${state.result.printed ?? "nil"}\n`);
    }
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
