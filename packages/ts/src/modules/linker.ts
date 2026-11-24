/** Output-neutral linker and library adapter interface.
 *
 * Both bundled Effect libraries (TypeScript output) and file-module descriptor
 * form libraries (e.g., JSON output with `:emit` and `:graph` hooks) plug into
 * the same adapter interface and system graph builder.
 */
import type { JsonValue } from "../artifact/artifact.js";
import { authorNames, type Diagnostic, type Span } from "../diagnostic/diagnostic.js";
import { diagnosticLocator } from "../diagnostic/locations.js";
import { isKFloat, isKKeyword, isKSymbol, type KValue } from "../evaluator/types.js";
import { list, sym } from "../surface/effect.js";
import type { Scheme } from "../type/types.js";
import { ModuleError, type ModuleGraph } from "./graph.js";

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

/** The program's declarations and relations as inspectable data. */
export interface SystemGraph {
  readonly nodes: readonly SystemNode[];
  readonly edges: readonly SystemEdge[];
}

export interface SystemGraphBuilder {
  /** Adds a node and returns its id. */
  readonly node: (kind: string, name: string, span?: Span, data?: Readonly<Record<string, JsonValue>>) => string;
  /** Adds an edge; edges to nodes that do not exist are dropped unless retained for module merging. */
  readonly edge: (from: string, to: string, kind: string) => void;
  /** Adds an edge from `from` to each declared schema or error that a type refers to. */
  readonly uses: (from: string, type: JsonValue | undefined, kind?: string) => void;
}

export function createSystemGraphBuilder(
  resolveTypeRefs?: (type: JsonValue) => readonly string[],
): {
  readonly add: SystemGraphBuilder;
  readonly build: (keepDanglingEdges?: boolean) => SystemGraph;
} {
  const nodes = new Map<string, SystemNode>();
  const edges = new Map<string, SystemEdge>();
  const pending: [string, string, string][] = [];
  const add: SystemGraphBuilder = {
    node: (kind, name, span, data) => {
      const id = `${kind}:${name}`;
      nodes.set(id, { id, kind, name, ...(span ? { span } : {}), ...(data ? { data } : {}) });
      return id;
    },
    edge: (from, to, kind) => {
      edges.set(`${from} ${kind} ${to}`, { from, to, kind });
    },
    uses: (from, type, kind = "uses") => {
      if (type == null || !resolveTypeRefs) return;
      let names: readonly string[] = [];
      try { names = resolveTypeRefs(type); } catch { /* unsupported types have no edges */ }
      for (const n of names) pending.push([from, n, kind]);
    },
  };
  return {
    add,
    build: (keepDanglingEdges = false): SystemGraph => {
      for (const [from, n, kind] of pending) {
        add.edge(from, nodes.has(`error:${n}`) ? `error:${n}` : `schema:${n}`, kind);
      }
      return {
        nodes: [...nodes.values()],
        edges: [...edges.values()].filter(e => keepDanglingEdges || (nodes.has(e.from) && nodes.has(e.to))),
      };
    },
  };
}

/** One emitted module artifact produced by a library adapter. */
export interface LinkedModuleArtifact<TOutput = unknown> {
  readonly moduleId: string;
  readonly fileName: string;
  readonly format: string;
  readonly output: TOutput;
}

/** Output-neutral result of linking a module graph through a library adapter. */
export interface LinkedSystemResult<TOutput = unknown> {
  readonly ok: boolean;
  readonly entry: string;
  readonly format: string;
  readonly modules: readonly LinkedModuleArtifact<TOutput>[];
  readonly system: SystemGraph;
  readonly diagnostics: readonly Diagnostic[];
}

export interface LibraryAdapterContext {
  readonly environments?: ReadonlyMap<string, ReadonlyMap<string, Scheme>>;
  readonly outputPath?: (moduleId: string) => string;
}

/** Output-neutral adapter for linking a class of DSL libraries over a ModuleGraph. */
export interface LibraryAdapter<TOutput = unknown> {
  readonly id: string;
  readonly format: string;
  readonly matches: (graph: ModuleGraph) => boolean;
  readonly link: (graph: ModuleGraph, context: LibraryAdapterContext) => LinkedSystemResult<TOutput>;
}

/** Run the first matching adapter over a resolved module graph. */
export function linkModuleSystem<TOutput = unknown>(
  graph: ModuleGraph,
  adapters: readonly LibraryAdapter<TOutput>[],
  context: LibraryAdapterContext = {},
): LinkedSystemResult<TOutput> | undefined {
  const adapter = adapters.find(a => a.matches(graph));
  if (!adapter) return undefined;
  const result = adapter.link(graph, context);
  const locate = diagnosticLocator(id => graph.modules.find(m => m.id === id)?.source);
  return {
    ...result,
    diagnostics: result.diagnostics.map(d => locate({ ...d, message: authorNames(d.message) })),
  };
}

/** Convert a compile-time KValue to plain JSON, stripping internal module-identity mangling. */
export function kValueToJson(value: KValue): JsonValue {
  if (value === null) return null;
  if (typeof value === "boolean" || typeof value === "number") return value;
  if (typeof value === "string") return authorNames(value);
  if (isKFloat(value)) return Number.isFinite(value.value) ? value.value : String(value.value);
  if (isKSymbol(value)) return authorNames(value.name);
  if (isKKeyword(value)) return value.name.slice(1);
  if (Array.isArray(value)) return value.map(kValueToJson);
  if (value instanceof Map) {
    const out: Record<string, JsonValue> = {};
    for (const [key, val] of value) {
      const normalized = authorNames(key.replace(/^:/, ""));
      out[normalized] = kValueToJson(val);
    }
    return out;
  }
  throw new Error("Emitted value is not JSON-serializable data.");
}

const isJsonObject = (v: JsonValue): v is Readonly<Record<string, JsonValue>> =>
  v !== null && typeof v === "object" && !Array.isArray(v);

const defaultJsonOutputPath = (id: string): string =>
  id.endsWith(".lisp") && !id.includes(":") ? id.replace(/\.lisp$/, ".json") : `${id}.json`;

/** File-module adapter for descriptor `form` libraries declaring `:emit` and/or `:graph` hooks. */
export const descriptorFormAdapter: LibraryAdapter<JsonValue> = {
  id: "descriptor-forms",
  format: "json",
  matches: (graph) =>
    graph.modules.some(module =>
      (module.compileTime?.elaborated() ?? []).some(app => {
        const options = app.linkedForm?.descriptor.surface?.options;
        return Boolean(options?.has(":emit") || options?.has(":graph"));
      }),
    ),
  link: (graph, context) => {
    const outputPath = context.outputPath ?? defaultJsonOutputPath;
    const diagnostics: Diagnostic[] = [];
    const artifacts: LinkedModuleArtifact<JsonValue>[] = [];
    const { add, build } = createSystemGraphBuilder();
    const report = (span: Span, code: string, message: string): void => {
      diagnostics.push({ code, severity: "error", phase: "emit", message: authorNames(message), span });
    };

    for (const module of graph.modules) {
      const apps = module.compileTime?.elaborated() ?? [];
      const emitted: JsonValue[] = [];
      for (const app of apps) {
        const linkedForm = app.linkedForm;
        const spec = linkedForm?.descriptor.surface;
        if (!linkedForm || !spec) continue;
        const emitHook = spec.options.get(":emit");
        const graphHook = spec.options.get(":graph");
        if (!emitHook && !graphHook) continue;
        const hookEnv = linkedForm.owner.environment().extend({ __ir: app.ir });

        if (emitHook) {
          try {
            const raw = linkedForm.owner.run(list(emitHook, [emitHook, sym(emitHook, "__ir")]), hookEnv);
            emitted.push(kValueToJson(raw));
          } catch (error) {
            if (error instanceof ModuleError) diagnostics.push(...error.diagnostics);
            else report(app.span, "linker/emit", error instanceof Error ? error.message : String(error));
          }
        }

        if (graphHook) {
          try {
            const raw = linkedForm.owner.run(list(graphHook, [graphHook, sym(graphHook, "__ir")]), hookEnv);
            const data = kValueToJson(raw);
            if (!isJsonObject(data)) {
              report(app.span, "linker/graph", ":graph hook must return a record with optional :nodes and :edges.");
              continue;
            }
            const nodes = data["nodes"];
            if (nodes !== undefined) {
              if (!Array.isArray(nodes)) {
                report(app.span, "linker/graph", ":graph :nodes must be a list.");
              } else {
                for (const entry of nodes) {
                  if (!isJsonObject(entry) || typeof entry["kind"] !== "string" || typeof entry["name"] !== "string") {
                    report(app.span, "linker/graph", "Each :graph node must have string :kind and :name.");
                    continue;
                  }
                  const nodeData = entry["data"];
                  add.node(
                    entry["kind"],
                    entry["name"],
                    app.span,
                    nodeData !== undefined && isJsonObject(nodeData) ? nodeData : undefined,
                  );
                }
              }
            }
            const edges = data["edges"];
            if (edges !== undefined) {
              if (!Array.isArray(edges)) {
                report(app.span, "linker/graph", ":graph :edges must be a list.");
              } else {
                for (const entry of edges) {
                  if (!isJsonObject(entry) || typeof entry["from"] !== "string" || typeof entry["to"] !== "string" || typeof entry["kind"] !== "string") {
                    report(app.span, "linker/graph", "Each :graph edge must have string :from, :to, and :kind.");
                    continue;
                  }
                  add.edge(entry["from"], entry["to"], entry["kind"]);
                }
              }
            }
          } catch (error) {
            if (error instanceof ModuleError) diagnostics.push(...error.diagnostics);
            else report(app.span, "linker/graph", error instanceof Error ? error.message : String(error));
          }
        }
      }
      if (emitted.length) {
        artifacts.push({
          moduleId: module.id,
          fileName: outputPath(module.id),
          format: "json",
          output: emitted,
        });
      }
    }

    const failed = diagnostics.some(d => d.severity === "error");
    return {
      ok: !failed,
      entry: outputPath(graph.entry),
      format: "json",
      modules: failed ? [] : artifacts,
      system: build(false),
      diagnostics,
    };
  },
};
