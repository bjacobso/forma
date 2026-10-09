/** Immutable operation boundary for the registries and fresh-name supply of HM inference. */
import { Effect, Ref } from "effect";
import type { InferContextService, ADTInfo, ClassInfo, InstanceInfo } from "./context.js";
import type { TypeExpr } from "./core-expr.js";
import type { Type } from "./types.js";
import type { Subst } from "./substitution.js";

export interface InferenceSnapshot {
  readonly nextTypeVariable: number;
  readonly nextRowVariable: number;
  readonly nextEffectVariable: number;
  readonly subst: Subst;
  readonly typeAliases: ReadonlyMap<string, TypeExpr>;
  readonly nominalRecords: ReadonlyMap<string, Type>;
  readonly typeAliasParams: ReadonlyMap<string, readonly string[]>;
  readonly errorTypes: ReadonlySet<string>;
  readonly adtRegistry: ReadonlyMap<string, ADTInfo>;
  readonly constructorToType: ReadonlyMap<string, string>;
  readonly classRegistry: ReadonlyMap<string, ClassInfo>;
  readonly instanceRegistry: ReadonlyMap<string, readonly InstanceInfo[]>;
}

export const captureInferenceSnapshot = (
  context: InferContextService,
  supply: Pick<InferenceSnapshot, "nextTypeVariable" | "nextRowVariable" | "nextEffectVariable">,
): Effect.Effect<InferenceSnapshot> => Effect.gen(function* () {
  return {
    ...supply,
    subst: yield* Ref.get(context.subst),
    typeAliases: new Map(yield* Ref.get(context.typeAliases)),
    nominalRecords: new Map(yield* Ref.get(context.nominalRecords)),
    typeAliasParams: new Map(yield* Ref.get(context.typeAliasParams)),
    errorTypes: new Set(yield* Ref.get(context.errorTypes)),
    adtRegistry: new Map(yield* Ref.get(context.adtRegistry)),
    constructorToType: new Map(yield* Ref.get(context.constructorToType)),
    classRegistry: new Map(yield* Ref.get(context.classRegistry)),
    instanceRegistry: new Map([...(yield* Ref.get(context.instanceRegistry))].map(([name, instances]) => [name, [...instances]])),
  };
});
