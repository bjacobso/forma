import { expandKernelExprsSync } from "../evaluator/frontend.js";
import type { PackageableDeclaration } from "../artifact/artifact.js";
import { checkModuleGraph } from "./check.js";
import { inferredModuleSignatures } from "./signatures.js";
import type { Diagnostic } from "../diagnostic/diagnostic.js";
import { mechanicsPackageableDeclarations } from "../mechanics/artifact.js";
import { normalizeEffectProgram } from "../surface/effect.js";
import { checkMechanicsDeclarations } from "../mechanics/check.js";
import { generateMechanicsEffectTypeScriptModule } from "../mechanics/effect-typescript.js";
import { camelIdentifier, typeName } from "../mechanics/naming.js";
import { isRecord } from "../mechanics/types.js";
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
/** Project with graph-wide resolved metadata, preserving each expression's author file. */
export function moduleMechanicsDeclarations(graph: ModuleGraph): {
  declarations: readonly PackageableDeclaration[];
  diagnostics: readonly Diagnostic[];
} {
  const check = checkModuleGraph(graph);
  if (!check.ok) return { declarations: [], diagnostics: check.diagnostics };
  const enriched = graph.modules.map((m) => {
    const hasMacros = m.expressions.some(
      (e) =>
        e._tag === "List" &&
        e.items[0]?._tag === "Sym" &&
        e.items[0].name === "macro",
    );
    const expandedDefinitions = hasMacros
      ? expandKernelExprsSync(m.expressions, {
          keepMacroDefs: false,
        }).expanded.filter(
          (e) =>
            e._tag === "List" &&
            e.items[0]?._tag === "Sym" &&
            e.items[0].name === "define",
        )
      : [];
    const expanded = hasMacros
      ? m.expressions.flatMap((e) => {
          if (e._tag !== "List" || e.items[0]?._tag !== "Sym") return [e];
          if (e.items[0].name === "macro") return [];
          if (e.items[0].name !== "define" || e.items[1]?._tag !== "Sym")
            return [e];
          const name = e.items[1].name;
          return [
            expandedDefinitions.find(
              (d) =>
                d._tag === "List" &&
                d.items[1]?._tag === "Sym" &&
                d.items[1].name === name,
            ) ?? e,
          ];
        })
      : m.expressions;
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
  const projected = declarations
    ? { declarations, diagnostics: [] as readonly Diagnostic[] }
    : moduleMechanicsDeclarations(graph);
  const declarationDiagnostics: Diagnostic[] = [];
  for (const module of graph.modules) {
    for (const expression of module.expressions) {
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
      if (binding.kind === "macro" || emitted.has(binding.symbol)) continue;
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
  const interfaces = checkModuleGraph(graph).interfaces,
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
        if (b.identity.moduleId !== module.id)
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
      const generated = generateMechanicsEffectTypeScriptModule(local, {
        check: checked.info,
        externalNames: new Set(external.keys()),
        exports: exported,
      });
      const reexports = module.interface.exports
        .filter((b) => b.identity.moduleId !== module.id)
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
