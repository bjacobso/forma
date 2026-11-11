/** Prelude-defined unary RPC contracts targeting native Effect 4. */
import type { PackageableDeclaration } from "./artifact/artifact.js";
import type { Diagnostic } from "./diagnostic/diagnostic.js";
import { bootstrapPreludes } from "./Preludes.js";
import { elaborateProgram, sourceLocator } from "./descriptor/elaborate.js";
import { emissionDatum, emissionSchema, emitFormTypeScript } from "./descriptor/form-emitter.js";
import { checkMechanicsDeclarations } from "./mechanics/check.js";
import { generateEffectProgram } from "./mechanics/elaborate.js";
import { schemaReferences } from "./mechanics/effect-schema.js";
import { typeName } from "./mechanics/naming.js";
import { arrayItems, isRecord } from "./mechanics/types.js";
import { parse, toSExprMany } from "./reader/index.js";
import { head } from "./surface/effect.js";

export const bootstrapRpcPreludes = () => bootstrapPreludes(["compiler.lisp", "rpc.lisp"]);

export interface RpcProgramOptions {
  readonly sourceId?: string;
  /** Import referenced domain schemas instead of emitting the domain module.
   * The source must still include their declarations for checking. The caller
   * must supply a module exporting the corresponding generated schema values.
   */
  readonly schemasFrom?: string;
}

export interface RpcProgramResult {
  readonly ok: boolean;
  readonly declarations: readonly PackageableDeclaration[];
  readonly diagnostics: readonly Diagnostic[];
  readonly code?: string;
}

/** Assemble a module using the prelude's emit hooks and existing mechanics checks.
 * This adds no RPC cases to mechanics and generates no handler execution kernel.
 */
export function generateRpcProgram(source: string, options: RpcProgramOptions = {}): RpcProgramResult {
  const sourceId = options.sourceId ?? "rpc.lisp";
  const diagnostics: Diagnostic[] = [];
  let declarations: readonly PackageableDeclaration[] = [];
  const result = (code?: string): RpcProgramResult => ({
    ok: !diagnostics.some(d => d.severity === "error"), declarations, diagnostics,
    ...(code !== undefined && !diagnostics.some(d => d.severity === "error") ? { code } : {}),
  });
  try {
    const parsed = parse(source);
    const locate = sourceLocator(source, sourceId);
    for (const error of parsed.errors) diagnostics.push({
      code: "rpc/parse", severity: "error", phase: "parse", message: error.message,
      ...(error.loc ? { span: locate(error.loc) } : {}),
    });
    if (diagnostics.length) return result();
    const prelude = bootstrapRpcPreludes();
    const forms = toSExprMany(parsed.redTree);
    const projected = elaborateProgram(source, { prelude, sourceId });
    diagnostics.push(...projected.diagnostics);
    let mechanicsSource = source;
    for (const e of [...forms].reverse()) if (prelude.descriptions.get(head(e) ?? "")?.surface)
      mechanicsSource = mechanicsSource.slice(0, e.loc.start) + source.slice(e.loc.start, e.loc.end).replace(/[^\r\n]/g, " ") + mechanicsSource.slice(e.loc.end);
    const mechanics = generateEffectProgram(mechanicsSource, { sourceId });
    diagnostics.push(...mechanics.diagnostics.map(d => ({ ...d, phase: "typecheck" as const })));
    declarations = [...mechanics.declarations, ...projected.declarations];
    if (!result().ok) return result();

    const report = (d: PackageableDeclaration, code: string, message: string) => diagnostics.push({
      code: `rpc/${code}`, message, severity: "error", phase: "typecheck", span: d.span,
    });
    const exported = new Set([...mechanics.code!.matchAll(/^export (?:const|class|type) ([A-Za-z_$][\w$]*)/gm)].map(m => m[1]!));
    const names = new Set([...exported, "Rpc", "RpcGroup", "Schema"]);
    const schemaNames = new Set(exported);
    for (const d of mechanics.declarations)
      if (d.summary.name && ["Rpc", "RpcGroup"].includes(typeName(d.summary.name)))
        report(d, "name-collision", `Domain name ${d.summary.name} conflicts with an Effect RPC import.`);
    const references = new Set<string>();
    const schemas: PackageableDeclaration[] = [];
    const chunks: string[] = [];
    for (const d of projected.declarations) {
      if (d.formName !== "rpc-group") {
        report(d, "top-level", "Place RPC operations inside an rpc-group.");
        continue;
      }
      if (!isRecord(d.payload)) continue;
      const exportName = typeName(String(d.payload["name"]));
      if (names.has(exportName)) report(d, "name-collision", `Generated name ${exportName} is already in use.`);
      names.add(exportName);
      for (const operation of arrayItems(d.payload["operations"]).filter(isRecord)) {
        for (const field of ["payload", "success", "error"] as const) {
          const value = operation[field];
          if (value == null) continue;
          const schema = emissionSchema(emissionDatum(value));
          for (const ref of schemaReferences(schema)) references.add(ref);
          // Validate schema holes with the same checker as ordinary type forms.
          // These temporary declarations are checked, never emitted or returned.
          let index = schemas.length;
          let name = `RpcContract${index}`;
          while (schemaNames.has(typeName(name))) name = `RpcContract${++index}`;
          schemaNames.add(typeName(name));
          schemas.push({ ...d, summary: { kind: "SchemaDef", name, resultType: "SchemaDef" }, payload: { kind: "SchemaDef", name, schema } });
        }
      }
      chunks.push(`export const ${exportName} = ${emitFormTypeScript(prelude.descriptions.get(d.formName)!, d.payload, prelude.descriptions.list())};`);
    }
    const checked = checkMechanicsDeclarations([...mechanics.declarations, ...schemas]);
    diagnostics.push(...checked.diagnostics.map(d => ({ ...d, phase: "typecheck" as const })));
    if (!result().ok) return result();
    const target = chunks.join("\n\n");
    const imports = [...references].map(typeName).sort();
    const domain = options.schemasFrom === undefined ? mechanics.code!.trimEnd()
      : imports.length ? `import { ${imports.join(", ")} } from ${JSON.stringify(options.schemasFrom)};` : "";
    const rpcImports = ["Rpc", "RpcGroup"].filter(name => target.includes(`${name}.`));
    return result([
      domain,
      ...(rpcImports.length ? [`import { ${rpcImports.join(", ")} } from "effect/rpc";`] : []),
      ...(target.includes("Schema.") && !/^import .*\bSchema\b.* from "effect";/m.test(domain) ? ['import { Schema } from "effect";'] : []),
      "", target, "",
    ].filter((s, i) => s !== "" || i > 0).join("\n"));
  } catch (error) {
    diagnostics.push({ code: "rpc/emit", severity: "error", phase: "typecheck", message: String(error) });
    return result();
  }
}
