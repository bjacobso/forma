import type { PackageableDeclaration } from "../artifact/artifact.js";
import { checkModuleGraph, type ModuleCheckResult } from "./check.js";
import { inferredModuleSignatures } from "./signatures.js";
import type { Diagnostic } from "../diagnostic/diagnostic.js";
import { mechanicsPackageableDeclarations } from "../mechanics/artifact.js";
import { normalizeEffectProgram } from "../surface/effect.js";
import { checkMechanicsDeclarations } from "../mechanics/check.js";
import { generateMechanicsEffectTypeScriptModule } from "../mechanics/effect-typescript.js";
import { camelIdentifier, typeName } from "../mechanics/naming.js";
import { isRecord } from "../mechanics/types.js";
import { headSym, type SExpr } from "../reader/types.js";
import { flattenRow, type Type } from "../type/types.js";
import {
  type ModuleGraph,
  type ModuleBinding,
  type ModuleInterface,
} from "./graph.js";

export interface LinkedEffectModule {
  readonly moduleId: string;
  readonly fileName: string;
  readonly code: string;
}
export interface LinkedEffectProgram {
  readonly ok: boolean;
  readonly entry: string;
  readonly interfaces: readonly ModuleInterface[];
  readonly declarations: readonly PackageableDeclaration[];
  readonly modules: readonly LinkedEffectModule[];
  readonly diagnostics: readonly Diagnostic[];
}
/** Flat, injective output names keep arbitrary virtual IDs out of filesystem paths. */
export function moduleOutputName(id: string): string {
  return `module_${[...new TextEncoder().encode(id)].map((b) => b.toString(16).padStart(2, "0")).join("")}.ts`;
}
export function generatedBindingName(binding: ModuleBinding): string {
  return ["type", "class", "error", "service", "layer"].includes(binding.kind)
    ? typeName(binding.symbol)
    : camelIdentifier(binding.symbol);
}

function containsTypeName(type: Type, names: ReadonlySet<string>): boolean {
  switch (type._tag) {
    case "TCon": return names.has(type.name);
    case "TFun": return containsTypeName(type.arg, names) || containsTypeName(type.res, names) || !!type.rest && containsTypeName(type.rest, names);
    case "TVariadic": return containsTypeName(type.rest, names) || containsTypeName(type.res, names);
    case "TApp": return containsTypeName(type.con, names) || type.args.some(t => containsTypeName(t, names));
    case "TRow": return [...flattenRow(type.row).fields.values()].some(t => containsTypeName(t, names));
    default: return false;
  }
}

/** Metadata stays in the compile-time interface, never in generated JS imports. */
function compileTimeBindings(graph: ModuleGraph, check: ModuleCheckResult): ReadonlySet<string> {
  const metaTypes = new Set(["Declaration", "Syntax", "RuntimeExpr", "Symbol", "Keyword", "Type", "FormDescriptor"]);
  const syntaxContainsMeta = (e: SExpr): boolean => e._tag === "Sym" ? metaTypes.has(e.name)
    : e._tag === "Map" ? e.pairs.some(([, value]) => syntaxContainsMeta(value))
    : e._tag === "List" || e._tag === "Vector" ? e.items.some(syntaxContainsMeta) : false;
  let changed = true;
  while (changed) {
    changed = false;
    for (const module of graph.modules) for (const [name, type] of module.compileTime?.types ?? [])
      if (!metaTypes.has(name) && syntaxContainsMeta(type)) { metaTypes.add(name); changed = true; }
  }
  const symbols = new Set<string>();
  const runtimeTypes = new Set(["Effect", "Stream", "Layer", "Fiber", "Ref", "RefCell"]);
  for (const module of graph.modules) for (const binding of module.bindings.values()) {
    const scheme = check.environments.get(module.id)?.get(binding.symbol);
    if (["macro", "form"].includes(binding.kind) || metaTypes.has(binding.symbol) ||
        (scheme && containsTypeName(scheme.type, metaTypes) && !containsTypeName(scheme.type, runtimeTypes)))
      symbols.add(binding.symbol);
  }
  return symbols;
}

function targetExpressions(module: ModuleGraph["modules"][number], compileOnly: ReadonlySet<string>): readonly SExpr[] {
  const expressions = module.runtimeExpressions ?? module.expressions;
  const expanded = module.compileTime?.expand(expressions) ?? expressions;
  return expanded.filter(e => {
    const head = headSym(e);
    if (head === "form" || head === "macro" || module.compileTime?.forms.has(head ?? "")) return false;
    const name = e._tag === "List" && e.items[1]?._tag === "Sym" ? e.items[1].name : undefined;
    return !name || !compileOnly.has(name);
  });
}
/** Project with graph-wide resolved metadata, preserving each expression's author file. */
export function moduleMechanicsDeclarations(graph: ModuleGraph): {
  declarations: readonly PackageableDeclaration[];
  diagnostics: readonly Diagnostic[];
} {
  return projectModuleMechanics(graph, checkModuleGraph(graph));
}

function projectModuleMechanics(graph: ModuleGraph, check: ModuleCheckResult): {
  declarations: readonly PackageableDeclaration[];
  diagnostics: readonly Diagnostic[];
} {
  if (!check.ok) return { declarations: [], diagnostics: check.diagnostics };
  const compileOnly = compileTimeBindings(graph, check);
  const enriched = graph.modules.map((m) => {
    const expanded = targetExpressions(m, compileOnly);
    return {
      ...m,
      expressions: inferredModuleSignatures(
        { ...m, expressions: expanded },
        check.environments.get(m.id)!,
      ),
    };
  });
  const expressions = enriched.flatMap((m) => m.expressions);
  const normalized = normalizeEffectProgram(expressions, true, true);
  const declarations: PackageableDeclaration[] = [],
    diagnostics: Diagnostic[] = [];
  for (const module of enriched) {
    const locations = new Set(module.expressions.map((e) => e.loc));
    const owned = normalized.filter((e) => locations.has(e.loc));
    const result = mechanicsPackageableDeclarations(
      owned,
      module.id,
      true,
      normalized,
    );
    if (result.ok) declarations.push(...result.declarations);
    else
      diagnostics.push(
        ...result.diagnostics.map((d) => ({
          ...d,
          severity: "error" as const,
          phase: "elaborate" as const,
        })),
      );
  }
  return { declarations, diagnostics };
}
/** Native hosts pass their independently projected declarations through the same linker. */
export function linkEffectModules(
  graph: ModuleGraph,
  declarations?: readonly PackageableDeclaration[],
): LinkedEffectProgram {
  const moduleCheck = checkModuleGraph(graph);
  const compileOnly = compileTimeBindings(graph, moduleCheck);
  const projected = declarations
    ? { declarations, diagnostics: [] as readonly Diagnostic[] }
    : projectModuleMechanics(graph, moduleCheck);
  const declarationDiagnostics: Diagnostic[] = [];
  for (const module of graph.modules) {
    for (const expression of targetExpressions(module, compileOnly)) {
      const head =
        expression._tag === "List" && expression.items[0]?._tag === "Sym"
          ? expression.items[0].name
          : "";
      if (
        [
          "define",
          ":",
          "type",
          "class",
          "error",
          "service",
          "layer",
          "macro",
          "form",
          "typeclass",
          "instance",
        ].includes(head)
      )
        continue;
      declarationDiagnostics.push({
        code: "module/target-expression",
        severity: "error",
        phase: "emit",
        message:
          "Linked Effect TypeScript requires declarations. Define and export the entry Effect value, then run it explicitly.",
        span: {
          sourceId: module.id,
          startOffset: expression.loc.start,
          endOffset: expression.loc.end,
        },
      });
    }
    const emitted = new Set(
      projected.declarations
        .filter((d) => d.sourceId === module.id)
        .map((d) => d.summary.name),
    );
    for (const binding of module.bindings.values()) {
      if (compileOnly.has(binding.symbol) || emitted.has(binding.symbol)) continue;
      const expression = module.expressions.find(
        (e) =>
          e._tag === "List" &&
          (e.items[1]?._tag === "Sym"
            ? e.items[1].name
            : e.items[1]?._tag === "List" && e.items[1].items[0]?._tag === "Sym"
              ? e.items[1].items[0].name
              : undefined) === binding.symbol,
      );
      declarationDiagnostics.push({
        code: "module/target-declaration",
        severity: "error",
        phase: "emit",
        message: `${binding.name} is outside the linked Effect TypeScript declaration subset.`,
        ...(expression
          ? {
              span: {
                sourceId: module.id,
                startOffset: expression.loc.start,
                endOffset: expression.loc.end,
              },
            }
          : {}),
      });
    }
  }
  const checked = checkMechanicsDeclarations(projected.declarations);
  const diagnostics: Diagnostic[] = [
    ...projected.diagnostics,
    ...declarationDiagnostics,
    ...checked.diagnostics.map((d) => ({ ...d, phase: "typecheck" as const })),
  ];
  const interfaces = moduleCheck.interfaces,
    modules: LinkedEffectModule[] = [];
  if (!diagnostics.some((d) => d.severity === "error")) {
    const owners = new Map(
      projected.declarations
        .filter((d) => d.summary.name)
        .map((d) => [d.summary.name!, d.sourceId]),
    );
    for (const module of graph.modules) {
      const local = projected.declarations.filter(
        (d) => d.sourceId === module.id,
      );
      const external = new Map<string, string>();
      const visit = (v: unknown): void => {
        if (typeof v === "string") {
          const symbol = owners.has(v) ? v : v.split(".")[0]!;
          const owner = owners.get(symbol);
          if (owner && owner !== module.id) external.set(symbol, owner);
        } else if (Array.isArray(v)) v.forEach(visit);
        else if (v && typeof v === "object") Object.values(v).forEach(visit);
      };
      local.forEach((d) => visit(d.payload));
      // Public signatures may refer to transitive types even without a local runtime use.
      for (const b of module.interface.exports)
        if (b.identity.moduleId !== module.id && !compileOnly.has(b.symbol))
          external.set(b.symbol, b.identity.moduleId);
      const imports: string[] = [];
      const byOwner = new Map<string, string[]>();
      for (const [symbol, owner] of external) {
        const payload = projected.declarations.find(
          (d) => d.summary.name === symbol,
        )?.payload;
        const kind = isRecord(payload) ? payload["kind"] : undefined;
        const name = [
          "SchemaDef",
          "ClassDef",
          "ErrorDef",
          "ServiceDef",
          "LayerDef",
        ].includes(String(kind))
          ? typeName(symbol)
          : camelIdentifier(symbol);
        const schema = isRecord(payload) ? payload["schema"] : undefined;
        const helpers =
          isRecord(schema) && schema["kind"] === "TaggedUnion"
            ? [`${typeName(symbol)}Constructors`]
            : [];
        byOwner.set(owner, [...(byOwner.get(owner) ?? []), name, ...helpers]);
      }
      // Every authored dependency initializes, even when none of its exports
      // occur in this module's generated declarations. Keep source import order.
      for (const owner of new Set([
        ...module.dependencies,
        ...byOwner.keys(),
      ])) {
        const names = byOwner.get(owner);
        const path = JSON.stringify(
          `./${moduleOutputName(owner).replace(/\.ts$/, ".js")}`,
        );
        imports.push(
          names?.length
            ? `import { ${[...new Set(names)].sort().join(", ")} } from ${path};`
            : `import ${path};`,
        );
      }
      const exported = new Set(
        module.interface.exports
          .filter((b) => b.identity.moduleId === module.id)
          .map((b) => b.symbol),
      );
      // Macro expansion can refer to private definition-site helpers by compiler
      // identity. Export them only in generated code so other generated modules
      // can link the reference; the language interface remains private.
      for (const consumer of graph.modules)
        if (consumer.id !== module.id) {
          const references = JSON.stringify(consumer.runtimeExpressions ?? consumer.expressions);
          for (const binding of module.bindings.values())
            if (references.includes(JSON.stringify(binding.symbol)))
              exported.add(binding.symbol);
        }
      const generated = generateMechanicsEffectTypeScriptModule(local, {
        check: checked.info,
        externalNames: new Set(external.keys()),
        exports: exported,
      });
      const reexports = module.interface.exports
        .filter((b) => b.identity.moduleId !== module.id && !compileOnly.has(b.symbol))
        .map(
          (b) =>
            `export { ${[generatedBindingName(b), ...(b.constructors.length ? [`${typeName(b.symbol)}Constructors`] : [])].join(", ")} } from ${JSON.stringify(`./${moduleOutputName(b.identity.moduleId).replace(/\.ts$/, ".js")}`)};`,
        );
      modules.push({
        moduleId: module.id,
        fileName: moduleOutputName(module.id),
        code: [...imports, ...reexports, generated.code].join("\n"),
      });
    }
  }
  return {
    ok: !diagnostics.some((d) => d.severity === "error"),
    entry: moduleOutputName(graph.entry),
    interfaces,
    declarations: projected.declarations,
    modules,
    diagnostics,
  };
}
