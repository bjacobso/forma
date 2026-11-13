/** Descriptor adapters over the existing, lexically resolved module graph. */
import type { PackageableDeclaration } from "../artifact/artifact.js";
import { authorNames, type Diagnostic } from "../diagnostic/diagnostic.js";
import { diagnosticLocator } from "../diagnostic/locations.js";
import { typeName, camelIdentifier } from "../mechanics/naming.js";
import { inferredModuleSignatures } from "../modules/signatures.js";
import type { Scheme } from "../type/types.js";
import { head } from "../surface/effect.js";
import type { ModuleGraph, ResolvedModule } from "../modules/graph.js";
import { moduleOutputName, generatedBindingName, type LinkedEffectProgram, type LinkedEffectModule } from "../modules/link.js";
import { effectLibraries, isEffectLibrary } from "./libraries.js";
import { linkEffectSystem, type EffectExtension, type EffectSystemGraph } from "./link.js";

export const hasEffectLibraries = (graph: ModuleGraph): boolean => graph.modules.some(m => isEffectLibrary(m.id));

export function moduleExtensions(module: ResolvedModule): readonly EffectExtension[] {
  return [...new Set([...module.dependencies, ...[...module.imports.values(), ...module.namespaceImports].map(b => b.identity.moduleId)])]
    .filter(isEffectLibrary).map(id => effectLibraries[id]());
}

/** Remove adapter-owned declarations before the ordinary lexical module check. */
export function ordinaryEffectGraph(graph: ModuleGraph): ModuleGraph {
  const owned = new Set(graph.modules.flatMap(module => {
    const forms = new Set(moduleExtensions(module).flatMap(extension => extension.forms));
    return module.expressions.flatMap(e => forms.has(head(e) ?? "") && e._tag === "List" && e.items[1]?._tag === "Sym" ? [e.items[1].name] : []);
  }));
  return { ...graph, modules: graph.modules.filter(m => !isEffectLibrary(m.id)).map(module => {
    const forms = new Set(moduleExtensions(module).flatMap(e => e.forms));
    return { ...module,
      expressions: module.expressions.filter(e => !forms.has(head(e) ?? "")),
      imports: new Map([...module.imports].filter(([, b]) => !isEffectLibrary(b.identity.moduleId) && !owned.has(b.symbol))),
      namespaceImports: module.namespaceImports.filter(b => !isEffectLibrary(b.identity.moduleId) && !owned.has(b.symbol)),
      bindings: new Map([...module.bindings].filter(([, b]) => !owned.has(b.symbol))),
      dependencies: module.dependencies.filter(id => !isEffectLibrary(id)),
      interface: { ...module.interface, exports: module.interface.exports.filter(b => !owned.has(b.symbol) && !isEffectLibrary(b.identity.moduleId)) },
    };
  }) };
}

/** Each module emits once. Imports use the existing flat, injective module output names. */
export function linkEffectLibraryModules(graph: ModuleGraph, environments: ReadonlyMap<string, ReadonlyMap<string, Scheme>> = new Map()): LinkedEffectProgram & { readonly system: EffectSystemGraph } {
  const declarations: PackageableDeclaration[] = [];
  const diagnostics: Diagnostic[] = [];
  const modules: LinkedEffectModule[] = [];
  const nodes = new Map<string, EffectSystemGraph["nodes"][number]>();
  const edges = new Map<string, EffectSystemGraph["edges"][number]>();
  const completed = new Map<string, { declarations: readonly PackageableDeclaration[]; scope: readonly import("../reader/types.js").SExpr[] }>();
  for (const module of graph.modules) {
    if (isEffectLibrary(module.id)) continue;
    const ancestors = new Set<string>();
    const collect = (id: string): void => {
      if (ancestors.has(id) || isEffectLibrary(id)) return;
      ancestors.add(id);
      graph.modules.find(m => m.id === id)?.dependencies.forEach(collect);
    };
    module.dependencies.forEach(collect);
    const dependencies = [...ancestors].flatMap(id => completed.get(id)?.declarations ?? []);
    const scope = [...ancestors].flatMap(id => completed.get(id)?.scope ?? []);
    const expanded = module.compileTime?.expand(module.expressions) ?? module.expressions;
    let authored: readonly import("../reader/types.js").SExpr[];
    try { authored = inferredModuleSignatures({ ...module, expressions: expanded }, environments.get(module.id) ?? new Map()); }
    catch (error) {
      const loc = (error as { loc?: import("../reader/types.js").Loc }).loc;
      diagnostics.push({ code: "module/unrepresentable-signature", severity: "error", phase: "elaborate",
        message: error instanceof Error ? error.message : String(error),
        ...(loc ? { span: { sourceId: loc.sourceId ?? module.id, startOffset: loc.start, endOffset: loc.end } } : {}),
      });
      break;
    }
    const linked = linkEffectSystem(module.source, moduleExtensions(module), { sourceId: module.id, namespace: "effect-system" }, { authored, scope, dependencies });
    diagnostics.push(...linked.diagnostics);
    if (!linked.ok || linked.code === undefined) break;
    declarations.push(...linked.declarations);
    linked.system?.nodes.forEach(node => nodes.set(node.id, node));
    linked.system?.edges.forEach(edge => edges.set(JSON.stringify(edge), edge));
    completed.set(module.id, { declarations: linked.declarations, scope: authored.filter(e => !moduleExtensions(module).some(extension => extension.forms.includes(head(e) ?? ""))) });
    const imports: string[] = [];
    // Generated dependency names are already resolved identities. This includes
    // schema values referenced only by descriptor IR (not ordinary mechanics).
    for (const dependency of modules) {
      if (!ancestors.has(dependency.moduleId)) continue;
      const exports = [...dependency.code.matchAll(/^export (?:const|class|type) ([\w$]+)/gm)].map(m => m[1]!);
      const names = [...new Set(exports)].filter(name => {
        const identifier = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        return new RegExp(`(?<![\\w$])${identifier}(?![\\w$])`).test(linked.code!);
      });
      if (names.length || module.dependencies.includes(dependency.moduleId)) {
        const path = JSON.stringify(`./${dependency.fileName.replace(/\.ts$/, ".js")}`);
        imports.push(names.length ? `import { ${names.sort().join(", ")} } from ${path};` : `import ${path};`);
      }
    }
    const aliases = new Map<string, string>();
    const publicNames = new Map<string, string>();
    const exported = [...linked.code.matchAll(/^export (?:const|class|type) ([\w$]+)/gm)].map(m => m[1]!);
    for (const binding of module.interface.exports) {
      if (binding.identity.moduleId !== module.id) continue;
      for (const [internal, publicName] of [[typeName(binding.symbol), typeName(binding.name)], [camelIdentifier(binding.symbol), camelIdentifier(binding.name)]]) {
        for (const name of exported) if (name === internal || name === `${internal}Constructors` || binding.kind === "declaration" && name.startsWith(internal!)) {
          const alias = name.replace(internal!, publicName!);
          const previous = publicNames.get(alias);
          if (previous && previous !== name) {
            const expression = module.expressions.find(e => e._tag === "List" && e.items[1]?._tag === "Sym" && e.items[1].name === binding.symbol);
            diagnostics.push({ code: "mechanics/name-collision", severity: "error", phase: "emit",
              message: `Public exports both become the TypeScript name ${alias}; rename one.`,
              ...(expression ? { span: { sourceId: module.id, startOffset: expression.loc.start, endOffset: expression.loc.end } } : {}),
            });
          }
          publicNames.set(alias, name);
          aliases.set(name, alias);
        }
      }
    }
    const reexports = module.interface.exports.filter(binding => binding.identity.moduleId !== module.id && !isEffectLibrary(binding.identity.moduleId)).map(binding => {
      const name = generatedBindingName(binding);
      const publicName = ["type", "class", "error", "service", "layer", "declaration"].includes(binding.kind) ? typeName(binding.name) : camelIdentifier(binding.name);
      return `export { ${name}, ${name} as ${publicName} } from ${JSON.stringify(`./${moduleOutputName(binding.identity.moduleId).replace(/\.ts$/, ".js")}`)};`;
    });
    const publicExports = [...aliases].filter(([internal, name]) => internal !== name)
      .map(([internal, name]) => `export { ${internal} as ${name} };`);
    modules.push({ moduleId: module.id, fileName: moduleOutputName(module.id), code: `${[...imports, ...reexports, linked.code.trimEnd(), ...publicExports].join("\n")}\n` });
  }
  const locate = diagnosticLocator(id => graph.modules.find(m => m.id === id)?.source);
  const located = diagnostics.map(d => locate({ ...d, message: authorNames(d.message) }));
  return {
    ok: !located.some(d => d.severity === "error"), entry: moduleOutputName(graph.entry),
    system: { nodes: [...nodes.values()], edges: [...edges.values()].filter(edge => nodes.has(edge.from) && nodes.has(edge.to)) },
    interfaces: graph.modules.map(m => m.interface), declarations, modules: located.some(d => d.severity === "error") ? [] : modules, diagnostics: located,
  };
}
