import { Effect } from "effect";
import { Env } from "../Env.js";
import { defaultBuiltins } from "../Builtins.js";
import { evaluateExprs } from "../evaluator/eval.js";
import type { KernelResult, KValue } from "../evaluator/types.js";
import {
  ObservationCollector,
  type ObservationOptions,
} from "../evaluator/observation.js";
import { headSym, type SExpr } from "../reader/types.js";
import { ModuleError, type ModuleGraph } from "./graph.js";

export interface ModuleInstance {
  readonly moduleId: string;
  readonly source: string;
  readonly dependencies: readonly ModuleInstance[];
  readonly result: KernelResult;
  readonly collector?: ObservationCollector;
}
const definition = (e: SExpr): boolean =>
  [
    "define",
    ":",
    "type",
    "class",
    "error",
    "macro",
    "form",
    "typeclass",
    "instance",
  ].includes(headSym(e) ?? "");
const referencedSymbols = (expressions: readonly SExpr[]): Set<string> => {
  const symbols = new Set<string>();
  const visit = (e: SExpr): void => {
    if (e._tag === "Sym" && e.name.includes("__forma_")) symbols.add(e.name);
    else if (e._tag === "Map")
      e.pairs.forEach(([k, v]) => {
        visit(k);
        visit(v);
      });
    else if (e._tag === "List" || e._tag === "Vector") e.items.forEach(visit);
  };
  expressions.forEach(visit);
  return symbols;
};
/** Runtime-local definition cache. Entry expressions run only on explicit evaluation. */
export class ModuleRuntime {
  readonly instances = new Map<string, ModuleInstance>();
  private initializing: Promise<void> = Promise.resolve();
  constructor(readonly core: Env = Env.empty()) {}

  async initialize(
    graph: ModuleGraph,
    stepLimit = 50_000,
    observe?: ObservationOptions,
  ): Promise<ModuleInstance> {
    const previous = this.initializing;
    let complete!: () => void;
    this.initializing = new Promise<void>((resolve) => {
      complete = resolve;
    });
    await previous;
    try {
      return await this.initializeDefinitions(graph, stepLimit, observe);
    } finally {
      complete();
    }
  }
  private async initializeDefinitions(
    graph: ModuleGraph,
    stepLimit: number,
    observe?: ObservationOptions,
  ): Promise<ModuleInstance> {
    // Effect programs execute through the linked Effect target. The kernel must not
    // accidentally execute an Effect initializer while importing its definitions.
    for (const module of graph.modules) {
      const effect = module.expressions.find(
        (e) =>
          ["service", "layer"].includes(headSym(e) ?? "") ||
          (headSym(e) === ":" &&
            e._tag === "List" &&
            headSym(e.items[2]!) === "Effect"),
      );
      if (effect)
        throw new ModuleError({
          code: "module/effect-runtime",
          severity: "error",
          phase: "evaluate",
          message:
            "Evaluate this Effect program through linkEffectModules and the Effect runtime; kernel module evaluation supports pure definitions.",
          span: {
            sourceId: module.id,
            startOffset: effect.loc.start,
            endOffset: effect.loc.end,
          },
        });
    }
    for (const module of graph.modules) {
      const dependencies = module.dependencies.map(
        (id) => this.instances.get(id)!,
      );
      const previous = this.instances.get(module.id);
      if (
        !(observe && module.id === graph.entry) &&
        previous?.source === module.source &&
        previous.dependencies.length === dependencies.length &&
        dependencies.every(
          (instance, i) => instance === previous.dependencies[i],
        )
      )
        continue;
      const env = this.importedEnvironment(module, dependencies);
      const collector =
        observe && module.id === graph.entry
          ? new ObservationCollector(module.source, module.expressions, observe)
          : undefined;
      const result = await Effect.runPromise(
        evaluateExprs(module.expressions.filter(definition), {
          env,
          builtins: defaultBuiltins,
          includePrelude: false,
          stepLimit,
          ...(collector ? { observer: collector } : {}),
        }),
      );
      this.instances.set(module.id, {
        moduleId: module.id,
        source: module.source,
        dependencies,
        result,
        ...(collector ? { collector } : {}),
      });
    }
    return this.instances.get(graph.entry)!;
  }

  private importedEnvironment(
    module: ModuleGraph["modules"][number],
    dependencies: readonly ModuleInstance[],
  ): Env {
    const imported = [
      ...module.imports.values(),
      ...module.namespaceImports,
      ...module.interface.exports.filter(
        (b) => b.identity.moduleId !== module.id,
      ),
    ];
    const allowed = new Set(
      imported.flatMap((b) => [
        b.symbol,
        `__type/${b.symbol}`,
        `__type-kind/${b.symbol}`,
        `__constructor/${b.symbol}`,
        ...b.constructors.flatMap((c) => [
          `${b.symbol}.${c}`,
          `__constructor/${b.symbol}.${c}`,
        ]),
      ]),
    );
    const values: Record<string, KValue> = {};
    const referenced = referencedSymbols(module.expressions);
    for (const dependency of new Set([
      ...dependencies,
      ...this.instances.values(),
    ])) {
      const env = dependency.result.env;
      const ownerMarker = `__forma_${[...new TextEncoder().encode(dependency.moduleId)].map((b) => b.toString(16).padStart(2, "0")).join("")}_d`;
      for (const name of env.bindingNames())
        if (
          name.includes(ownerMarker) &&
          (allowed.has(name) || referenced.has(name))
        )
          values[name] = env.lookup(name)!;
    }
    return this.core.extend(values);
  }
  async imports(graph: ModuleGraph, stepLimit = 50_000): Promise<Env> {
    const libraries = graph.modules.filter((m) => m.id !== graph.entry);
    if (libraries.length)
      await this.initialize(
        { entry: libraries.at(-1)!.id, modules: libraries },
        stepLimit,
      );
    const entry = graph.modules.find((m) => m.id === graph.entry)!;
    return this.importedEnvironment(
      entry,
      entry.dependencies.map((id) => this.instances.get(id)!),
    );
  }
  async evaluate(
    graph: ModuleGraph,
    stepLimit = 50_000,
    observe?: ObservationOptions,
  ): Promise<{ result: KernelResult; collector?: ObservationCollector }> {
    const instance = await this.initialize(graph, stepLimit, observe);
    const entry = graph.modules.find((m) => m.id === graph.entry)!;
    const expressions = entry.expressions.filter((e) => !definition(e));
    const { collector } = instance;
    const result = expressions.length
      ? await Effect.runPromise(
          evaluateExprs(expressions, {
            env: instance.result.env,
            builtins: defaultBuiltins,
            includePrelude: false,
            stepLimit,
            ...(collector ? { observer: collector } : {}),
          }),
        )
      : instance.result;
    return { result, ...(collector ? { collector } : {}) };
  }
  reset(): void {
    this.instances.clear();
  }
}
