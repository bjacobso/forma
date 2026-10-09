import type { LanguageSession } from "../session/session.js";
import { parse, toSExprMany } from "../reader/index.js";
import type { SExpr } from "../reader/types.js";
import { relativeModuleId } from "../modules/graph.js";
import type { PackageableDeclaration, JsonValue } from "./artifact.js";
import { sha256 } from "./canonical-json.js";

export interface ArtifactModule {
  readonly moduleId: string;
  readonly sourcePath: string;
  readonly sourceHash: string;
  readonly usedPreludes: readonly { readonly prelude: string }[];
  readonly imports: readonly Record<string, JsonValue>[];
  readonly exports: readonly Record<string, JsonValue>[];
  readonly reExports: readonly Record<string, JsonValue>[];
  readonly declarations: readonly { readonly localName: string; readonly kind: string; readonly canonicalName: string }[];
  readonly diagnostics: readonly JsonValue[];
  readonly publicExportHash: string;
}
const text = (e?: SExpr): string | undefined => e?._tag === "Sym" ? e.name : e?._tag === "Str" ? e.value : undefined;
const names = (e?: SExpr): string[] => e?._tag === "Vector" || e?._tag === "List" ? e.items.flatMap(item => text(item) ?? []) : text(e) ? [text(e)!] : [];

/** Manifest projection only; module resolution/typechecking belongs to modules/. */
export function artifactModules(session: LanguageSession, declarations: readonly PackageableDeclaration[], sourceIds: readonly string[]): readonly ArtifactModule[] {
  return sourceIds.map(sourceId => {
    const local = declarations.filter(d => d.sourceId === sourceId && d.summary.name !== undefined).map(d => ({ localName: d.summary.name!, kind: d.summary.kind, canonicalName: `${sourceId}/${d.summary.name}` }));
    const usedPreludes: { prelude: string }[] = [], imports: Record<string, JsonValue>[] = [], exports: Record<string, JsonValue>[] = [], reExports: Record<string, JsonValue>[] = [];
    for (const form of toSExprMany(parse(session.sourceText(sourceId) ?? "").redTree)) {
      if (form._tag !== "List") continue;
      const head = text(form.items[0]);
      if (head === "use" && text(form.items[1])) usedPreludes.push({ prelude: text(form.items[1])! });
      if (head === "export") for (const name of form.items.slice(1).flatMap(names)) {
        const declaration = local.find(d => d.localName === name);
        exports.push({ localName: name, exportedName: name, canonicalName: `${sourceId}/${name}`, ...(declaration ? { kind: declaration.kind } : {}) });
      }
      if (head === "import" || head === "export-from") {
        const specifier = text(form.items[1]);
        if (!specifier) continue;
        const target = relativeModuleId(specifier, sourceId);
        const resolved = session.source(target) ? { resolvedPath: target, moduleId: target } : {};
        const mode = text(form.items[2])?.replace(/^:/, "");
        if (head === "export-from") reExports.push({ specifier, names: form.items.slice(2).flatMap(names), ...resolved });
        else imports.push({ specifier, mode: mode === "as" ? "alias" : mode === "all" ? "all" : "refer", ...resolved, ...(mode === "as" ? { alias: text(form.items[3]) ?? "" } : mode === "refer" ? { names: names(form.items[3]) } : {}) });
      }
    }
    // Match module_decl_artifact.ml's public interface hash wire format.
    const exportRecords = exports.map(e => JSON.stringify({ localName: e["localName"], exportedName: e["exportedName"], ...(e["kind"] ? { kind: e["kind"] } : {}), canonicalName: e["canonicalName"] })).sort();
    const reExportRecords = reExports.map(e => JSON.stringify({ specifier: e["specifier"], ...(e["resolvedPath"] ? { resolvedPath: e["resolvedPath"] } : {}), ...(e["moduleId"] ? { moduleId: e["moduleId"] } : {}), names: [...e["names"] as readonly string[]].sort() })).sort();
    const publicExportHash = sha256(`{"exports":[${exportRecords.join(",")}],"reExports":[${reExportRecords.join(",")}]}`);
    return { moduleId: sourceId, sourcePath: sourceId, sourceHash: session.source(sourceId)?.hash ?? "", usedPreludes, imports, exports, reExports, declarations: local, diagnostics: [], publicExportHash };
  });
}
