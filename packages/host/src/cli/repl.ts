import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createInterface } from "node:readline";
import type { JsonAbi } from "../json-abi.js";
import { renderDiagnostics } from "./output.js";

export async function repl(abi: JsonAbi, preludes: readonly string[]) {
  let sessionId = "";
  const sources = new Map<string, string>();
  const diagnostics = (list: Parameters<typeof renderDiagnostics>[0]) => {
    if (list.length) process.stderr.write(renderDiagnostics(list, id => sources.get(id)));
  };
  async function reset(): Promise<boolean> {
    if (sessionId) await abi.host.closeSession({ sessionId });
    sources.clear();
    ({ sessionId } = await abi.host.openSession());
    for (const path of preludes) {
      const sourceId = resolve(path), source = readFileSync(sourceId, "utf8");
      sources.set(sourceId, source);
      const loaded = await abi.host.loadSource({ sessionId, sourceId, source, kind: "prelude" });
      diagnostics(loaded.diagnostics);
      if (loaded.diagnostics.some(d => d.severity === "error")) return false;
    }
    return true;
  }
  let rl: ReturnType<typeof createInterface> | undefined;
  try {
    if (!await reset()) { process.exitCode = 1; return; }
    const terminal = Boolean(process.stdin.isTTY && process.stdout.isTTY);
    rl = createInterface({ input: process.stdin, output: process.stdout, terminal, crlfDelay: Infinity });
    rl.setPrompt("forma> ");
    if (terminal) rl.prompt();
    let index = 0;
    for await (const input of rl) {
      const line = input.trim();
      if (line === ":quit") break;
      if (line === ":reset") {
        if (!await reset()) { process.exitCode = 1; break; }
      } else if (line) {
        const query = line.startsWith(":type ");
        const source = query ? line.slice(6).trim() : input;
        const sourceId = `<repl:${++index}>`;
        sources.set(sourceId, source);
        if (query) {
          const result = await abi.host.typecheck({ sessionId, sourceId, source });
          diagnostics(result.diagnostics);
          if (!result.diagnostics.some(d => d.severity === "error")) process.stdout.write(`${result.type?.display ?? result.display ?? "?"}\n`);
        } else {
          const result = await abi.host.replSubmit!({ sessionId, sourceId, source });
          if (result.status === "completed") {
            diagnostics(result.result.diagnostics);
            process.stdout.write(`${result.result.printed ?? "nil"} : ${result.result.type?.display ?? "?"}\n`);
          } else if (result.status === "failed") diagnostics(result.diagnostics);
        }
      }
      if (terminal) rl.prompt();
    }
  } finally {
    rl?.close();
    if (sessionId) await abi.host.closeSession({ sessionId });
  }
}
