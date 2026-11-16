/** Bounded experiment, not a supported compiler cache or a trusted artifact loader. */
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { Effect, Ref } from "effect";
import { resolveModuleGraph, sourceModuleResolver, type ModuleSource } from "../../packages/ts/src/modules/graph.js";
import { checkModuleGraph } from "../../packages/ts/src/modules/check.js";
import { moduleFormProvider } from "../../packages/ts/src/modules/compile-time.js";
import { lowerProgram } from "../../packages/ts/src/type/lower.js";
import { definitionComponents, inferProgram } from "../../packages/ts/src/type/infer-program.js";
import { InferContext, makeOwnedInferContext } from "../../packages/ts/src/type/context.js";
import { ftvType, frvType, fevType, type Scheme } from "../../packages/ts/src/type/types.js";
import type { CoreExpr } from "../../packages/ts/src/type/core-expr.js";

export const entry = "trials/vendor-risk/src/register.forma";
export const policy = "trials/vendor-risk/src/policy.forma";
export const forms = "trials/vendor-risk/src/register-forms.forma";
export const kernel = "preludes/kernel.forma";

export function sources(): ModuleSource[] {
  return [entry, policy, forms, kernel].map(id => ({ id, source: readFileSync(id, "utf8") }));
}

export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value).filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
    .map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
  return JSON.stringify(value);
}

export const hash = (domain: string, value: unknown): string =>
  createHash("sha256").update(`${domain}\0${canonical(value)}`).digest("hex");

/** Actual compiler sources and dependency lock, rather than a manually trusted version label. */
export function compilerFingerprint(): string {
  const files = (path: string): string[] => readdirSync(path, { withFileTypes: true }).flatMap(e =>
    e.isDirectory() ? files(join(path, e.name)) : e.name.endsWith(".ts") ? [join(path, e.name)] : []);
  return hash("compiler/v1", [...files("packages/ts/src"), "pnpm-lock.yaml", "trials/vendor-risk/cache-trial.ts"]
    .sort().map(path => [path, readFileSync(path, "utf8")]));
}

/** Node IDs/locations are not semantic identity. Exact source hashes still guard reuse. */
function shape(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(shape);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !["id", "span", "loc"].includes(key)).map(([k, v]) => [k, shape(v)]));
  return value;
}

/** Closed schemes only: bound IDs get a separate namespace, never inference-counter IDs. */
function portable(scheme: Scheme): Scheme {
  for (const [free, bound] of [[ftvType(scheme.type), scheme.tvars], [frvType(scheme.type), scheme.rvars],
    [fevType(scheme.type), scheme.evars]] as const) {
    if ([...free].some(id => !bound.includes(id))) throw new Error("Trial refuses an open scheme");
  }
  if (scheme.constraints.length) throw new Error("Trial refuses typeclass constraints");
  const names = new Map([...scheme.tvars.map((id, i) => [id, `cache-t${i}`] as const),
    ...scheme.rvars.map((id, i) => [id, `cache-r${i}`] as const),
    ...scheme.evars.map((id, i) => [id, `cache-e${i}`] as const)]);
  const rename = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(rename);
    if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, child]) =>
      [k, k === "id" && typeof child === "string" ? names.get(child) ?? child : rename(child)]));
    return v;
  };
  return JSON.parse(canonical({ ...scheme, type: rename(scheme.type),
    tvars: scheme.tvars.map(id => names.get(id)), rvars: scheme.rvars.map(id => names.get(id)),
    evars: scheme.evars.map(id => names.get(id)) })) as Scheme;
}

export interface TrialOptions {
  compiler: string;
  checker: string;
  /** The trial only runs the default host; arbitrary callbacks are deliberately unsupported. */
  mode: "batch" | "editor";
  preludeOrder: readonly string[];
}
export interface Event {
  names: string[];
  definitions: string[];
  component: string;
  outcome: "hit" | "miss";
  reasons: string[];
}

export class TrialStore {
  readonly db: DatabaseSync;
  constructor(filename: string) {
    this.db = new DatabaseSync(filename);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS checks (key TEXT PRIMARY KEY, slot TEXT NOT NULL, inputs TEXT NOT NULL, schemes TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS releases (id TEXT PRIMARY KEY, parent TEXT, bundle TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS refs (name TEXT PRIMARY KEY, release TEXT NOT NULL);
    `);
  }
  close(): void { this.db.close(); }
  pin(bundle: readonly ModuleSource[], options: TrialOptions, parent: string | null = null): string {
    // A release is a history node, not just the content of its source bundle.
    const value = { bundle, options, parent };
    const id = hash("release/v1", value);
    this.db.prepare("INSERT OR IGNORE INTO releases VALUES (?, ?, ?)").run(id, parent, canonical(value));
    return id;
  }
  moveRef(name: string, release: string): void {
    if (!this.db.prepare("SELECT id FROM releases WHERE id = ?").get(release)) throw new Error("Missing release");
    this.db.prepare("INSERT OR REPLACE INTO refs VALUES (?, ?)").run(name, release);
  }
  load(id: string): { bundle: ModuleSource[]; options: TrialOptions } {
    const row = this.db.prepare("SELECT bundle FROM releases WHERE id = ?").get(id);
    if (!row) throw new Error("Missing pinned release");
    const value = JSON.parse(row.bundle as string);
    if (hash("release/v1", value) !== id) throw new Error("Corrupt release");
    return value;
  }
}

/**
 * All compile-time work and graph/effect validation run fresh. Only the pure policy
 * module's HM definition bodies are eligible. Every invocation checks its schemes
 * against an independent, uncached checkModuleGraph call before committing entries.
 */
export function runTrial(store: TrialStore, bundle: readonly ModuleSource[], options: TrialOptions) {
  const graph = resolveModuleGraph(bundle.find(s => s.id === entry)!, sourceModuleResolver(bundle));
  const module = graph.modules.find(m => m.id === policy)!;
  if ([...module.imports.values(), ...module.namespaceImports].some(b => b.kind !== "macro"))
    throw new Error("Trial policy may only import macros");
  const expressions = module.compileTime!.expand(module.expressions);
  const provider = moduleFormProvider(module.compileTime!);
  const core = lowerProgram(expressions, provider, { includePrelude: false, types: module.compileTime!.types,
    contextTypes: graph.modules.flatMap(m => m.id === policy ? [] : m.expressions.filter(e =>
      e._tag === "List" && e.items[0]?._tag === "Sym" && e.items[0].name === "type")) });
  if (core.some(e => e._tag !== "Def" && e._tag !== "TypeDef")) throw new Error("Unsupported trial policy form");
  type Definition = CoreExpr & { _tag: "Def" };
  // Match inferProgram's consecutive runs, not an invented whole-file recursion group.
  const groups: Definition[][] = [];
  for (let i = 0; i < core.length; i++) {
    if (core[i]!._tag !== "Def") continue;
    const run: Definition[] = [core[i] as Definition];
    while (core[i + 1]?._tag === "Def") run.push(core[++i] as Definition);
    groups.push(...definitionComponents(run));
  }
  const inputBase = {
    ...Object.fromEntries(bundle.map(s => [`source:${s.id}`, hash("source/v1", s)])),
    compiler: options.compiler, checker: options.checker, mode: options.mode,
    preludes: hash("ordered-preludes/v1", options.preludeOrder), runtime: process.versions.node,
  };
  const events: Event[] = [];
  const hits = new Set<CoreExpr>();
  const initial = new Map<string, Scheme>();
  const pending: { key: string; slot: string; inputs: string; group: Definition[] }[] = [];
  for (const group of groups) {
    const names = group.map(d => d.name);
    const definitions = group.map(d => hash("definition/v1", shape(d)));
    const component = hash("component/v1", definitions);
    const inputs = { ...inputBase, component };
    const key = hash("check/v1", inputs), slot = canonical(names);
    const row = store.db.prepare("SELECT schemes FROM checks WHERE key = ?").get(key);
    const previous = store.db.prepare("SELECT inputs FROM checks WHERE slot = ? ORDER BY rowid DESC LIMIT 1").get(slot);
    const before = previous ? JSON.parse(previous.inputs as string) : undefined;
    const reasons = row ? [] : before ? Object.entries(inputs).filter(([k, v]) => before[k] !== v).map(([k]) => k) : ["not-stored"];
    events.push({ names, definitions, component, outcome: row ? "hit" : "miss", reasons });
    if (row) {
      const schemes = JSON.parse(row.schemes as string) as [string, Scheme][];
      if (canonical(schemes.map(([name]) => name)) !== canonical(names)) throw new Error("Cache binding mismatch");
      for (const [name, scheme] of schemes) initial.set(name, portable(scheme));
      group.forEach(d => hits.add(d));
    } else pending.push({ key, slot, inputs: canonical(inputs), group });
  }
  const inferred = Effect.runSync(Effect.gen(function* () {
    const ctx = yield* makeOwnedInferContext();
    let env = initial;
    yield* Effect.provideService(inferProgram(core.filter(e => !hits.has(e)), initial, provider, expressions,
      value => { env = new Map(value); }), InferContext, ctx);
    if ((yield* Ref.get(ctx.diagnostics)).length || (yield* Ref.get(ctx.pendingConstraints)).length)
      throw new Error("Trial does not cache warnings or deferred constraints");
    return env;
  }));
  // Independent graph reconstruction reruns form checks, elaboration and mechanics.
  const cleanGraph = resolveModuleGraph(bundle.find(s => s.id === entry)!, sourceModuleResolver(bundle));
  const clean = checkModuleGraph(cleanGraph, { editor: options.mode === "editor" });
  if (!clean.ok) throw new Error(`Clean check failed: ${canonical(clean.diagnostics)}`);
  const schemeEntries = groups.flat().map(d => [d.name, portable(inferred.get(d.name)!)] as const);
  const expected = groups.flat().map(d => [d.name, portable(clean.environments.get(policy)!.get(d.name)!)] as const);
  if (canonical(schemeEntries) !== canonical(expected)) throw new Error("Cached/clean schemes differ");
  const projections = (g: typeof graph) => g.modules.map(m => [m.id, m.compileTime?.elaborated().map(e =>
    ({ form: e.form, name: e.name, ir: e.ir, span: e.span }))]);
  // IR includes Maps/symbol objects; compare their inspectable wire representation, not JSON's Map omission.
  const encode = (v: unknown): string => JSON.stringify(v, (_key, value) => value instanceof Map ? [...value] : value);
  if (encode(projections(graph)) !== encode(projections(cleanGraph))) throw new Error("Elaboration/provenance differs");
  store.db.exec("BEGIN");
  try {
    for (const item of pending) store.db.prepare("INSERT OR IGNORE INTO checks VALUES (?, ?, ?, ?)").run(
      item.key, item.slot, item.inputs, canonical(item.group.map(d => [d.name, portable(inferred.get(d.name)!)])));
    store.db.exec("COMMIT");
  } catch (error) { store.db.exec("ROLLBACK"); throw error; }
  return { events, hits: events.filter(e => e.outcome === "hit").length,
    misses: pending.length, inferredBodies: groups.flat().length - hits.size,
    schemes: schemeEntries, projections: encode(projections(graph)), diagnostics: clean.diagnostics };
}
