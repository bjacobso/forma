/** One linker for prelude-defined Effect libraries.
 *
 * Each library (RPC, HTTP API, Cluster) is an extension: a prelude plus hooks
 * that lower its declarations to ordinary Effect forms, check them against the
 * mechanics declarations, emit native TypeScript, and describe themselves in
 * the system graph. The linker elaborates every selected prelude in one pass,
 * runs one mechanics check over the authored and lowered forms, and assembles
 * one module. Adding a library adds an extension, not a linker.
 */
import type { JsonValue, PackageableDeclaration } from "../artifact/artifact.js";
import { diagnosticFromUnknown, type Diagnostic, type Span } from "../diagnostic/diagnostic.js";
import { bootstrapPreludes, preludeSource, type PreludeName } from "../Preludes.js";
import { bootstrapFromSources, type BootstrappedPrelude } from "../descriptor/bootstrap.js";
import { elaborateProgram, elaborateSources, sourceLocator, type ElaboratedDeclaration } from "../descriptor/elaborate.js";
import { SimpleSemanticEnvironment } from "../descriptor/SemanticEnvironment.js";
import { emissionDatum, emissionSchema } from "../descriptor/form-emitter.js";
import type { CheckInfo } from "../mechanics/check.js";
import { schemaReferences } from "../mechanics/effect-schema.js";
import { generateMechanicsEffectTypeScriptModule } from "../mechanics/effect-typescript.js";
import { elaborateEffectForms } from "../mechanics/elaborate.js";
import { typeName } from "../mechanics/naming.js";
import { parse, toSExprMany } from "../reader/index.js";
import type { SExpr } from "../reader/types.js";
import { resolveModuleGraph, ModuleError, type ModuleGraph } from "../modules/graph.js";
import { linkEffectLibraryModules } from "./modules.js";
import { checkModuleGraph } from "../modules/check.js";
import { ordinaryEffectGraph } from "./modules.js";
import type { LinkedEffectModule } from "../modules/link.js";
import { head, normalizeEffectProgram } from "../surface/effect.js";
import { mechanicsPackageableDeclarations } from "../mechanics/artifact.js";
import { checkMechanicsProgram } from "../mechanics/checked.js";

/** A declaration, service, entity, or other part of the linked system. */
export interface SystemNode {
  /** `kind:name`; child names are qualified by their parents, as in `rpc:Accounts/GetAccount`. */
  readonly id: string;
  readonly kind: string;
  readonly name: string;
  readonly span?: Span;
  readonly data?: Readonly<Record<string, JsonValue>>;
}
/** A typed relation between two nodes, such as `provides`, `requires`, `raises`, or `contains`. */
export interface SystemEdge {
  readonly from: string;
  readonly to: string;
  readonly kind: string;
}
/** The program's services, layers, operations, and library declarations as inspectable data. */
export interface EffectSystemGraph {
  readonly nodes: readonly SystemNode[];
  readonly edges: readonly SystemEdge[];
}

export interface SystemGraphBuilder {
  /** Adds a node and returns its id. */
  readonly node: (kind: string, name: string, span?: Span, data?: Readonly<Record<string, JsonValue>>) => string;
  /** Adds an edge; edges to nodes that do not exist are dropped. */
  readonly edge: (from: string, to: string, kind: string) => void;
  /** Adds an edge from `from` to each declared schema or error that a type refers to. */
  readonly uses: (from: string, type: JsonValue | undefined, kind?: string) => void;
}

export interface ExtensionContext {
  readonly source: string;
  readonly sourceId: string;
  readonly authored: readonly SExpr[];
  readonly prelude: BootstrappedPrelude;
  /** This extension's top-level declarations, in source order. */
  readonly declarations: readonly ElaboratedDeclaration[];
  readonly locate: (e: SExpr) => Span;
  /** Reports an error whose code is the extension's namespace and `code`. */
  readonly report: (span: Span | undefined, code: string, message: string) => void;
  /** Adds already-coded diagnostics, such as mechanics checker results. */
  readonly diagnose: (diagnostics: readonly Diagnostic[]) => void;
}
export interface MechanicsContext extends ExtensionContext {
  /** Dependency declarations, under their resolved module identities. */
  readonly importedDeclarations: readonly ElaboratedDeclaration[];
  readonly mechanics: readonly PackageableDeclaration[];
  readonly check: CheckInfo;
  /** Names the domain module exports. */
  readonly exports: ReadonlySet<string>;
}
export interface EmittedExport {
  readonly name: string;
  /** A TypeScript expression. */
  readonly code: string;
  /** Domain schemas the expression refers to, for `schemasFrom`. */
  readonly references?: readonly string[];
}

export interface EffectExtension {
  /** Diagnostic namespace, such as `rpc`. */
  readonly namespace: string;
  readonly prelude: PreludeName;
  /** Top-level forms this extension owns. */
  readonly forms: readonly string[];
  /** Target imports by module; names are imported only when the emitted code uses them. */
  readonly imports: Readonly<Record<string, readonly string[]>>;
  /** Checks that need no mechanics, and ordinary Effect forms that check this library's declarations. */
  readonly prepare?: (context: ExtensionContext) => readonly SExpr[];
  readonly check?: (context: MechanicsContext) => void;
  readonly emit: (declaration: ElaboratedDeclaration, context: MechanicsContext) => readonly EmittedExport[];
  readonly graph?: (declaration: ElaboratedDeclaration, context: MechanicsContext, add: SystemGraphBuilder) => void;
}

export interface LinkOptions {
  readonly sourceId: string;
  /** Namespace of the linker's own parse and emit diagnostics. */
  readonly namespace: string;
  /** @deprecated Use a file module import for domain schemas instead. */
  readonly schemasFrom?: string;
}

export interface LinkedEffectSystem {
  readonly ok: boolean;
  readonly declarations: readonly PackageableDeclaration[];
  readonly diagnostics: readonly Diagnostic[];
  readonly code?: string;
  readonly system?: EffectSystemGraph;
  /** One output per source module when linking a file-module graph. */
  readonly modules?: readonly LinkedEffectModule[];
}

const effectNames = ["Context", "Effect", "Layer", "Ref", "Schema"];
const effectImport = /^import \{ ([^}]*) \} from "effect";$/m;
const uses = (code: string, name: string) => new RegExp(`(?<![\\w$])${name}\\.`).test(code);

/** Internal module input. Dependencies retain resolved identities and author locations. */
export interface EffectModuleInput {
  readonly authored: readonly SExpr[];
  readonly scope: readonly SExpr[];
  readonly dependencies: readonly PackageableDeclaration[];
}

export function linkEffectSystem(source: string | ModuleGraph, extensions: readonly EffectExtension[], options: LinkOptions, input?: EffectModuleInput): LinkedEffectSystem {
  if (typeof source !== "string") {
    const checked = checkModuleGraph(ordinaryEffectGraph(source));
    if (!checked.ok) return { ok: false, declarations: [], diagnostics: checked.diagnostics };
    const linked = linkEffectLibraryModules(source, checked.environments);
    return { ok: linked.ok, declarations: linked.declarations, diagnostics: linked.diagnostics,
      ...(linked.ok ? { code: linked.modules.find(m => m.moduleId === source.entry)!.code, modules: linked.modules, system: linked.system } : {}),
    };
  }
  const { sourceId, namespace } = options;
  const diagnostics: Diagnostic[] = [];
  let declarations: readonly PackageableDeclaration[] = [];
  const failed = () => diagnostics.some(d => d.severity === "error");
  const result = (code?: string, system?: EffectSystemGraph): LinkedEffectSystem => ({
    ok: !failed(), declarations, diagnostics,
    ...(code !== undefined && !failed() ? { code } : {}),
    ...(system && !failed() ? { system } : {}),
  });
  const span = sourceLocator(source, sourceId);
  const locate = (e: SExpr): Span => span(e.loc);
  try {
    const parsed = parse(source);
    for (const error of parsed.errors) diagnostics.push({
      code: `${namespace}/parse`, severity: "error", phase: "parse", message: error.message,
      ...(error.loc ? { span: span(error.loc) } : {}),
    });
    if (failed()) return result();
    const authored = input?.authored ?? toSExprMany(parsed.redTree);
    if (!input && authored.some(e => ["import", "export", "export-from"].includes(head(e) ?? ""))) {
      try { return linkEffectSystem(resolveModuleGraph({ id: sourceId, source }, () => undefined), extensions, options); }
      catch (error) {
        if (error instanceof ModuleError) { diagnostics.push(...error.diagnostics); return result(); }
        throw error;
      }
    }
    const prelude = extensions.length ? bootstrapPreludes(["compiler.lisp", ...extensions.map(e => e.prelude)]) : bootstrapFromSources(preludeSource("compiler.lisp"), "");
    const importedDeclarations = (input?.dependencies ?? []).filter((d): d is ElaboratedDeclaration => "formName" in d);
    const semanticEnv = new SimpleSemanticEnvironment();
    for (const d of importedDeclarations) if (d.summary.name) semanticEnv.declareGlobal(d.summary.name, d.formName);
    const projected = input
      ? elaborateSources([{ sourceId, source, expressions: [...input.scope.filter(e => ["type", "class", "error"].includes(head(e) ?? "")), ...authored] }], { prelude, semanticEnv })
      : elaborateProgram(source, { prelude, sourceId });
    diagnostics.push(...projected.diagnostics);
    if (failed()) return result();

    const contexts = extensions.map((extension): ExtensionContext => ({
      source, sourceId, authored, prelude, locate,
      declarations: projected.declarations.filter(d => extension.forms.includes(d.formName)),
      report: (at, code, message) => diagnostics.push({
        code: `${extension.namespace}/${code}`, message, severity: "error", phase: "typecheck", ...(at ? { span: at } : {}),
      }),
      diagnose: ds => diagnostics.push(...ds),
    }));
    const lowered = extensions.flatMap((extension, i) => extension.prepare?.(contexts[i]!) ?? []);
    if (failed()) return result();

    // Library forms were checked by their preludes; everything else, and the
    // lowered forms, is an ordinary Effect program checked once.
    const ordinary = authored.filter(e => !prelude.descriptions.get(head(e) ?? "")?.surface);
    const mechanics = input
      ? moduleMechanics([...ordinary, ...lowered], input, sourceId)
      : elaborateEffectForms([...ordinary, ...lowered], source, { sourceId });
    diagnostics.push(...mechanics.diagnostics.map(({ phase: _, ...d }) => ({ ...d, phase: "typecheck" as const })));
    declarations = [...mechanics.declarations, ...projected.declarations];
    if (failed() || !mechanics.check) return result();
    const externalNames = new Set(input?.dependencies.flatMap(d => d.summary.name ? [d.summary.name] : []));
    const module = generateMechanicsEffectTypeScriptModule(mechanics.declarations, {
      check: mechanics.check, externalNames,
      ...(input ? { exports: new Set(mechanics.declarations.flatMap(d => d.summary.name ? [d.summary.name] : [])) } : {}),
    }).code;
    const exports = new Set([...module.matchAll(/^export (?:const|class|type) ([\w$]+)/gm)].map(m => m[1]!));
    const checked = contexts.map((context): MechanicsContext => ({
      ...context, importedDeclarations, mechanics: [...input?.dependencies ?? [], ...mechanics.declarations], check: mechanics.check!, exports,
    }));
    extensions.forEach((extension, i) => extension.check?.(checked[i]!));
    if (failed()) return result();

    // A domain name may not shadow an import its library's code needs.
    extensions.forEach((extension, i) => {
      if (!checked[i]!.declarations.length) return;
      const reserved = new Set(Object.values(extension.imports).flat());
      for (const d of mechanics.declarations)
        if (d.summary.name && reserved.has(typeName(d.summary.name)))
          checked[i]!.report(d.span, "name-collision", `Domain name ${d.summary.name} conflicts with an Effect import the generated code needs.`);
    });
    const names = new Set([...exports, ...effectNames, ...extensions.flatMap(e => Object.values(e.imports).flat())]);
    const chunks: string[] = [];
    const references = new Set<string>();
    const owner = new Map(projected.declarations.flatMap(d => {
      const i = extensions.findIndex(e => e.forms.includes(d.formName));
      return i < 0 ? [] : [[d, i] as const];
    }));
    for (const [d, i] of owner) {
      const context = checked[i]!;
      let emitted: readonly EmittedExport[];
      try { emitted = extensions[i]!.emit(d, context); }
      catch (error) { context.report(d.span, "emit", String(error)); continue; }
      for (const e of emitted) {
        if (names.has(e.name)) {
          context.report(d.syntax.holes["name"]?.[0]?.span ?? d.span, "name-collision", `Generated name ${e.name} is already in use.`);
          continue;
        }
        names.add(e.name);
        e.references?.forEach(r => references.add(r));
        chunks.push(`export const ${e.name} = ${e.code};`);
      }
    }
    if (failed()) return result();

    const target = chunks.join("\n\n");
    const libraryImports = new Map<string, Set<string>>();
    for (const extension of extensions) for (const [from, imported] of Object.entries(extension.imports))
      for (const n of imported) if (uses(target, n)) libraryImports.set(from, (libraryImports.get(from) ?? new Set()).add(n));
    const imports = [...libraryImports].sort(([a], [b]) => a.localeCompare(b))
      .map(([from, imported]) => `import { ${[...imported].sort().join(", ")} } from ${JSON.stringify(from)};`);
    const usedEffect = effectNames.filter(n => uses(target, n));
    let body: string;
    if (options.schemasFrom !== undefined) {
      const domain = [...references].map(typeName).sort();
      body = [
        ...(usedEffect.length ? [`import { ${usedEffect.join(", ")} } from "effect";`] : []),
        ...imports,
        ...(domain.length ? [`import { ${domain.join(", ")} } from ${JSON.stringify(options.schemasFrom)};`] : []),
      ].join("\n");
    } else {
      const present = module.match(effectImport)?.[1]?.split(", ") ?? [];
      const merged = [...new Set([...present, ...usedEffect])].sort();
      const header = [...(merged.length ? [`import { ${merged.join(", ")} } from "effect";`] : []), ...imports].join("\n");
      body = effectImport.test(module) ? module.replace(effectImport, header) : [header, module].filter(Boolean).join("\n\n");
    }
    const code = `${[body.trimEnd(), target].filter(Boolean).join("\n\n")}\n`;
    return result(code, systemGraph([...input?.dependencies ?? [], ...mechanics.declarations], mechanics.check, extensions, checked, owner, input !== undefined));
  } catch (error) {
    const diagnostic = input ? diagnosticFromUnknown(error, "typecheck", sourceId) : undefined;
    diagnostics.push(diagnostic?.span ? diagnostic : { code: `${namespace}/emit`, severity: "error", phase: "typecheck", message: String(error) });
    return result();
  }
}

/** Project only this module, but normalize and check in the resolved graph's scope. */
function moduleMechanics(authored: readonly SExpr[], input: EffectModuleInput, sourceId: string) {
  const scope = normalizeEffectProgram([...input.scope, ...authored], true, true);
  const locations = new Set(authored.map(e => e.loc));
  const local = scope.filter(e => locations.has(e.loc));
  const projected = mechanicsPackageableDeclarations(local, sourceId, true, scope);
  if (!projected.ok) return { declarations: [], diagnostics: projected.diagnostics.map(d => ({ ...d, severity: "error" as const, phase: "typecheck" as const })), check: undefined };
  const checked = checkMechanicsProgram([...input.dependencies, ...projected.declarations]);
  return { declarations: projected.declarations, diagnostics: checked.diagnostics, check: checked.check };
}

/** Mechanics declarations give services, layers, operations, schemas, and
 * errors; each extension adds its own declarations and their relations.
 */
function systemGraph(
  mechanics: readonly PackageableDeclaration[],
  check: CheckInfo,
  extensions: readonly EffectExtension[],
  contexts: readonly MechanicsContext[],
  owner: ReadonlyMap<ElaboratedDeclaration, number>,
  pendingModuleEdges = false,
): EffectSystemGraph {
  const nodes = new Map<string, SystemNode>();
  const edges = new Map<string, SystemEdge>();
  const pending: [string, string, string][] = [];
  const add: SystemGraphBuilder = {
    node: (kind, name, span, data) => {
      const id = `${kind}:${name}`;
      nodes.set(id, { id, kind, name, ...(span ? { span } : {}), ...(data ? { data } : {}) });
      return id;
    },
    edge: (from, to, kind) => { edges.set(`${from} ${kind} ${to}`, { from, to, kind }); },
    uses: (from, type, kind = "uses") => {
      if (type == null) return;
      let names: readonly string[] = [];
      try { names = schemaReferences(emissionSchema(emissionDatum(type))); } catch { /* unsupported types have no edges */ }
      for (const n of names) pending.push([from, n, kind]);
    },
  };
  const keys = (set: ReadonlyMap<string, unknown>) => [...set.keys()].sort();
  for (const d of mechanics) {
    const n = d.summary.name;
    if (!n) continue;
    switch (d.summary.kind) {
      case "SchemaDef": case "ClassDef": add.node("schema", n, d.span); break;
      case "ErrorDef": add.node("error", n, d.span); break;
      case "ServiceDef": {
        const methods = check.services.get(n) ?? new Map();
        const id = add.node("service", n, d.span, { methods: [...methods.keys()] });
        for (const method of methods.values()) for (const e of keys(method.effect.errors)) add.edge(id, `error:${e}`, "raises");
        break;
      }
      case "LayerDef": {
        const layer = check.layers.get(n)?.type;
        const id = add.node("layer", n, d.span);
        for (const s of layer?.provides ?? []) add.edge(id, `service:${s}`, "provides");
        for (const s of keys(layer?.requirements ?? new Map())) add.edge(id, `service:${s.split(".")[0]}`, "requires");
        for (const e of keys(layer?.errors ?? new Map())) add.edge(id, `error:${e}`, "raises");
        break;
      }
      case "EffectDef": {
        const effect = check.operations.get(n)?.result;
        const capabilities = keys(effect?.requirements ?? new Map());
        const id = add.node("operation", n, d.span, { capabilities });
        for (const c of capabilities) add.edge(id, `service:${c.split(".")[0]}`, "requires");
        for (const e of keys(effect?.errors ?? new Map())) add.edge(id, `error:${e}`, "raises");
        break;
      }
    }
  }
  for (const [d, i] of owner) extensions[i]!.graph?.(d, contexts[i]!, add);
  for (const [from, n, kind] of pending) add.edge(from, nodes.has(`error:${n}`) ? `error:${n}` : `schema:${n}`, kind);
  return {
    nodes: [...nodes.values()],
    edges: [...edges.values()].filter(e => pendingModuleEdges || nodes.has(e.from) && nodes.has(e.to)),
  };
}
