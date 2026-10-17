/** Node-only formatting context. CLI and LSP share this resolver. */
import { realpathSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileModuleResolver } from "../Node.js";
import { resolveModuleGraph, ModuleError } from "../modules/graph.js";
import { parse } from "../reader/parser.js";
import { toSExprMany } from "../reader/to-sexpr.js";
import { extractMarkdownFences, isFormaFence } from "../source/markdown.js";
import { moduleFormatOptions } from "./module.js";
import type { FormatOptions } from "./layout.js";
import type { FormatDiagnostic } from "../Format.js";

export function fileFormatOptions(path: string, text: string, openFiles: ReadonlyMap<string, string> = new Map()): { readonly options: FormatOptions; readonly diagnostics: readonly FormatDiagnostic[] } {
  const moduleText = (id: string, content: string) => /\.md$/i.test(id) ? extractMarkdownFences(content).filter(b => isFormaFence(b) && !b.unsupported).map(b => b.text).join("\n") : content;
  const source = moduleText(path, text);
  const parsed = parse(source);
  if (parsed.errors.length) return { options: {}, diagnostics: [] };
  const expressions = toSExprMany(parsed.redTree);
  if (!expressions.some(e => e._tag === "List" && e.items[0]?._tag === "Sym" && ["import", "export-from"].includes(e.items[0].name))) return { options: {}, diagnostics: [] };
  const canonical = (candidate: string) => { try { return realpathSync(candidate); } catch { return resolve(candidate); } };
  try {
    const graph = resolveModuleGraph({ id: canonical(path), source }, (specifier, importer) => {
      const raw = resolve(dirname(importer), specifier), id = canonical(raw);
      const edited = openFiles.get(id) ?? openFiles.get(raw);
      const found = edited === undefined ? fileModuleResolver(specifier, importer) : { id, source: edited };
      return found && { ...found, source: moduleText(found.id, found.source) };
    });
    return { options: moduleFormatOptions(graph), diagnostics: [] };
  } catch (error) {
    return { options: {}, diagnostics: [{ code: "format/module-resolution", message: `Using local formatting declarations: ${error instanceof ModuleError ? error.diagnostic.message : String(error)}`, start: 0, end: 0 }] };
  }
}
