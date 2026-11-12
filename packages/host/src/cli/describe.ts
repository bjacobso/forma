import { readFile } from "node:fs/promises";
import { readModuleGraph, readNodePackages } from "@formalang/ts/node";
import type { JsonAbi } from "../json-abi.js";
import { descriptionMarkdown } from "../description.js";
import { report } from "./output.js";

export async function describe(abi: JsonAbi, args: readonly string[]): Promise<boolean> {
  let format = "md";
  let entry: string | undefined;
  const preludes: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === "--format") {
      format = args[++i] ?? "";
      if (format !== "md" && format !== "json") return false;
    } else if (arg === "--prelude") {
      const path = args[++i];
      if (!path || path.startsWith("-")) return false;
      preludes.push(path);
    } else if (arg.startsWith("-") || entry) return false;
    else entry = arg;
  }
  if ((!entry && !preludes.length) || (entry && preludes.length)) return false;
  const { sessionId } = await abi.host.openSession();
  try {
    if (entry) {
      const graph = readModuleGraph(entry);
      const packages = readNodePackages(entry);
      if (packages) await abi.host.configureSession({ sessionId, packages: packages.table });
      const loaded = await abi.host.loadSourceBundle({ sessionId, sources: graph.modules.map(module => ({ sourceId: module.id, source: module.source })) });
      if (loaded.diagnostics.some(d => d.severity === "error")) {
        report({ ok: false, diagnostics: loaded.diagnostics }, format === "json");
        return true;
      }
    } else {
      for (const path of preludes) {
        const loaded = await abi.host.loadSource({ sessionId, sourceId: path, source: await readFile(path, "utf8"), kind: "prelude" });
        if (loaded.diagnostics.some(d => d.severity === "error")) {
          report({ ok: false, diagnostics: loaded.diagnostics }, format === "json");
          return true;
        }
      }
    }
    const result = await abi.host.describe({ sessionId });
    if (result.diagnostics.some(d => d.severity === "error")) report({ ok: false, diagnostics: result.diagnostics }, format === "json");
    else process.stdout.write(format === "json" ? `${JSON.stringify(result, null, 2)}\n` : descriptionMarkdown(result));
    return true;
  } finally { await abi.host.closeSession({ sessionId }); }
}
