import { Effect, Layer, Ref } from "effect";
import { inferProgram } from "../type/infer-program.js";
import {
  makeInferContext,
  InferContext,
  type MakeInferContextOptions,
} from "../type/context.js";
import { lowerProgram } from "../type/lower.js";
import { resetNodeIds } from "../type/core-expr.js";
import { unifiedFormProvider } from "../type/unified-form-provider.js";
import { printSExpr } from "../evaluator/kvalue-to-source.js";
import type { TypeEnv } from "../type/substitution.js";
import { showType, type Scheme, type Type } from "../type/types.js";
import type { Diagnostic } from "../diagnostic/diagnostic.js";
import { diagnosticFromUnknown } from "../diagnostic/diagnostic.js";
import type { ModuleGraph, ModuleInterface, ResolvedModule } from "./graph.js";
import { schemeSyntax } from "./signatures.js";
import type { SExpr } from "../reader/types.js";
import { ModuleError } from "./graph.js";

export type CheckedModuleInterface = ModuleInterface;
export interface ModuleCheckOptions extends MakeInferContextOptions {
  readonly coreExpressions?: readonly SExpr[];
}
export interface ModuleCheckResult {
  readonly ok: boolean;
  readonly interfaces: readonly CheckedModuleInterface[];
  readonly diagnostics: readonly Diagnostic[];
  readonly environments: ReadonlyMap<string, ReadonlyMap<string, Scheme>>;
  readonly results: ReadonlyMap<string, Type>;
}
/** Check each lexical module separately, sharing only resolved dependency types. */
export function checkModuleGraph(
  graph: ModuleGraph,
  options: ModuleCheckOptions = {},
): ModuleCheckResult {
  const environments = new Map<string, TypeEnv>(),
    results = new Map<string, Type>(),
    diagnostics: Diagnostic[] = [];
  let current: ResolvedModule | undefined;
  try {
    Effect.runSync(
      Effect.gen(function* () {
        const ctx = yield* makeInferContext(options);
        let coreEnvironment: TypeEnv = new Map();
        if (options.coreExpressions?.length) {
          const expressions = options.coreExpressions;
          const provider = unifiedFormProvider(
            expressions.map(printSExpr).join("\n"),
            expressions,
          );
          yield* Effect.provide(
            inferProgram(
              lowerProgram(expressions, provider),
              coreEnvironment,
              provider,
              expressions,
              (env) => {
                coreEnvironment = env;
              },
            ),
            Layer.succeed(InferContext, ctx),
          );
        }
        const coreClasses = new Map(yield* Ref.get(ctx.classRegistry));
        const coreInstances = new Map(yield* Ref.get(ctx.instanceRegistry));
        resetNodeIds();
        for (const module of graph.modules) {
          current = module;
          // Compile-time dictionaries are lexical too. Imported nominal metadata
          // stays available by identity, but a sibling's private instances do not.
          yield* Ref.set(ctx.classRegistry, new Map(coreClasses));
          yield* Ref.set(ctx.instanceRegistry, new Map(coreInstances));
          yield* Ref.set(ctx.pendingConstraints, []);
          const initial = new Map(coreEnvironment);
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
          for (const dependency of module.dependencies)
            for (const [symbol, scheme] of environments.get(dependency) ?? []) {
              if (allowed.has(symbol)) initial.set(symbol, scheme);
            }
          const source = module.expressions.map(printSExpr).join("\n");
          const provider = unifiedFormProvider(source, module.expressions);
          const core = lowerProgram(module.expressions, provider);
          const result = yield* Effect.provide(
            inferProgram(core, initial, provider, module.expressions, (env) =>
              environments.set(module.id, env),
            ),
            Layer.succeed(InferContext, ctx),
          );
          results.set(module.id, result);
          for (const d of yield* Ref.get(ctx.diagnostics))
            diagnostics.push({
              code: "typecheck/diagnostic",
              severity: d.severity,
              message: d.message,
              phase: "typecheck",
              ...(d.span
                ? {
                    span: {
                      sourceId: module.id,
                      startOffset: d.span.start,
                      endOffset: d.span.end,
                    },
                  }
                : {}),
            });
          yield* Ref.set(ctx.diagnostics, []);
        }
        for (const module of graph.modules)
          for (const binding of module.interface.exports) {
            const scheme = environments
              .get(binding.identity.moduleId)
              ?.get(binding.symbol);

            const references = new Set<string>();
            const visit = (v: unknown): void => {
              if (Array.isArray(v)) v.forEach(visit);
              else if (v && typeof v === "object") {
                if (
                  "_tag" in v &&
                  (v._tag === "Sym" || v._tag === "TCon") &&
                  "name" in v &&
                  typeof v.name === "string"
                )
                  references.add(v.name.split(".")[0]!);
                Object.values(v).forEach(visit);
              }
            };
            if (scheme) visit(scheme.type);
            if (["type", "class", "error", "service"].includes(binding.kind)) {
              const owner = graph.modules.find(
                (m) => m.id === binding.identity.moduleId,
              )!;
              const declaration = owner.expressions.find(
                (e) =>
                  e._tag === "List" &&
                  (e.items[1]?._tag === "Sym"
                    ? e.items[1].name
                    : e.items[1]?._tag === "List" &&
                        e.items[1].items[0]?._tag === "Sym"
                      ? e.items[1].items[0].name
                      : undefined) === binding.symbol,
              );
              if (declaration?._tag === "List")
                visit(declaration.items.slice(2));
            }
            for (const owner of graph.modules)
              for (const b of owner.bindings.values()) {
                if (
                  !["type", "class", "error", "service"].includes(b.kind) ||
                  !references.has(b.symbol) ||
                  owner.interface.exports.some((e) => e.symbol === b.symbol)
                )
                  continue;
                const expression = module.expressions.find(
                  (e) =>
                    e._tag === "List" &&
                    e.items[1]?._tag === "Sym" &&
                    e.items[1].name === binding.symbol,
                );
                throw new ModuleError({
                  code: "module/private-type",
                  severity: "error",
                  phase: "typecheck",
                  message: `Public ${binding.name} exposes private type ${b.name} from ${owner.id}; export ${b.name} in its owning module.`,
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
      }),
    );
  } catch (error) {
    diagnostics.push(
      error instanceof ModuleError
        ? error.diagnostic
        : diagnosticFromUnknown(error, "typecheck", current?.id ?? graph.entry),
    );
  }
  const syntax = (e: SExpr): import("./graph.js").ModuleTypeSyntax => {
    switch (e._tag) {
      case "Sym":
        return e.name;
      case "Num":
      case "Str":
      case "Bool":
        return e.value;
      case "Map":
        return {
          fields: e.pairs.map(([k, v]) => [syntax(k), syntax(v)] as const),
        };
      case "Error":
        return e.message;
      default:
        return e.items.map(syntax);
    }
  };
  const interfaces = graph.modules.map((module) => ({
    ...module.interface,
    exports: module.interface.exports.map((binding) => {
      const owner = graph.modules.find(
        (m) => m.id === binding.identity.moduleId,
      )!;
      const expression = owner.expressions.find(
        (e) =>
          e._tag === "List" &&
          (e.items[1]?._tag === "Sym"
            ? e.items[1].name
            : e.items[1]?._tag === "List" && e.items[1].items[0]?._tag === "Sym"
              ? e.items[1].items[0].name
              : undefined) === binding.symbol,
      );
      const scheme = environments.get(owner.id)?.get(binding.symbol);
      if (
        expression?._tag === "List" &&
        ["type", "class", "error", "service"].includes(binding.kind)
      ) {
        const header = expression.items[1],
          variables =
            header?._tag === "List"
              ? header.items
                  .slice(1)
                  .flatMap((e) => (e._tag === "Sym" ? [e.name] : []))
              : [];
        const renamed = (e: SExpr): SExpr =>
          e._tag === "Sym" && variables.includes(e.name)
            ? { ...e, name: `a${variables.indexOf(e.name)}` }
            : e._tag === "Map"
              ? {
                  ...e,
                  pairs: e.pairs.map(([k, v]) => [k, renamed(v)] as const),
                }
              : e._tag === "List" || e._tag === "Vector"
                ? { ...e, items: e.items.map(renamed) }
                : e;
        const body =
          binding.kind === "service"
            ? { ...expression, items: expression.items.slice(2) }
            : expression.items[2];
        return body
          ? {
              ...binding,
              scheme: {
                parameters: variables.map((_, i) => `a${i}`),
                type: syntax(renamed(body)),
              },
            }
          : binding;
      }
      if (!expression || !scheme) return binding;
      // The portable interface syntax names quantified variables by order, not engine IDs.
      const type = syntax(schemeSyntax(scheme, expression, false));
      const parameters = Array.from(
        {
          length:
            scheme.tvars.length + scheme.rvars.length + scheme.evars.length,
        },
        (_, i) => `a${i}`,
      );
      return { ...binding, scheme: { parameters, type } };
    }),
  }));
  return {
    ok: !diagnostics.some((d) => d.severity === "error"),
    interfaces,
    diagnostics,
    environments,
    results,
  };
}
export function moduleResultDisplay(
  check: ModuleCheckResult,
  id: string,
): string {
  const type = check.results.get(id);
  return type ? showType(type) : "Unit";
}
