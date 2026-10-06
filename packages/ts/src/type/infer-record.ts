/**
 * Inference for records and field access.
 */
import { Effect, Ref } from "effect";
import type { Type, Row } from "./types.js";
import { TRow, REmpty, RExtend, tUnknown, TCon, TApp } from "./types.js";
import { applyType, applyEnv, type TypeEnv } from "./substitution.js";
import { assignType } from "./assign.js";
import { unify } from "./unify.js";
import { InferContext } from "./context.js";
import { InferenceError } from "./errors.js";
import type { CoreExpr } from "./core-expr.js";
import { originOf } from "./infer-core.js";
import type { InferFn } from "./infer-binding.js";

// ---------------------------------------------------------------------------
// Record
// ---------------------------------------------------------------------------

export const inferRecord = (
  env: TypeEnv,
  expr: CoreExpr & { _tag: "Record" },
  inferExpr: InferFn,
): Effect.Effect<Type, InferenceError, InferContext> =>
  Effect.gen(function* () {
    const ctx = yield* InferContext;
    let row: Row = REmpty;

    // Build row bottom-up (fields in reverse order so first field is outermost)
    const fieldTypes: Array<{ label: string; type: Type }> = [];
    for (const field of expr.fields) {
      const s = yield* Ref.get(ctx.subst);
      const envN = applyEnv(s, env);
      const ft = yield* inferExpr(envN, field.value);
      fieldTypes.push({ label: field.label, type: ft });
    }

    for (let i = fieldTypes.length - 1; i >= 0; i--) {
      const { label, type } = fieldTypes[i]!;
      const s = yield* Ref.get(ctx.subst);
      row = RExtend(label, applyType(s, type), row);
    }

    return TRow(row);
  });

// ---------------------------------------------------------------------------
// Get (record field access)
// ---------------------------------------------------------------------------

export const inferGet = (
  env: TypeEnv,
  expr: CoreExpr & { _tag: "Get" },
  inferExpr: InferFn,
): Effect.Effect<Type, InferenceError, InferContext> =>
  Effect.gen(function* () {
    const ctx = yield* InferContext;

    let recT = yield* inferExpr(env, expr.record);
    const nominal = applyType(yield* Ref.get(ctx.subst), recT);
    if (nominal._tag === "TCon") recT = (yield* Ref.get(ctx.nominalRecords)).get(nominal.name) ?? recT;

    if (expr.key) {
      const keyType = yield* inferExpr(env, expr.key);
      const resolved = applyType(yield* Ref.get(ctx.subst), recT);
      if (resolved._tag === "TApp" && resolved.con._tag === "TCon" && resolved.con.name === "Map" && resolved.args.length === 2) {
        yield* assignType(keyType, resolved.args[0]!, originOf(expr, "get-key"));
        return TApp(TCon("Option"),[resolved.args[1]!]);
      }
      if (resolved._tag === "TRow") {
        const types: Type[] = [];
        const keyKinds = new Set<string>();
        let row = resolved.row;
        while (row._tag === "RExtend") {
          keyKinds.add(row.label.startsWith(":") ? "Keyword" : "String");
          types.push(row.type);
          row = row.tail;
        }
        if (row._tag !== "REmpty") return yield* ctx.fail(originOf(expr,"get"),{message:"Computed lookup requires a closed record or a typed Map"});
        const domain = [...keyKinds].map(TCon);
        yield* assignType(keyType,domain.length === 1 ? domain[0]! : TApp(TCon("Union"),domain.length ? domain : [TCon("String"),TCon("Keyword")]),originOf(expr,"get-key"));
        const members = [...new Map(types.map(type => [JSON.stringify(type),type])).values()];
        return TApp(TCon("Option"),[members.length === 1 ? members[0]! : members.length ? TApp(TCon("Union"),members) : TCon("Never")]);
      }
      if (resolved._tag === "TCon" && resolved.name === "Unknown") return tUnknown;
      const value = yield* ctx.freshTVar;
      yield* unify(recT,TApp(TCon("Map"),[keyType,value]),originOf(expr,"get"));
      return TApp(TCon("Option"),[applyType(yield* Ref.get(ctx.subst),value)]);
    }

    // If the record type is Unknown (e.g., $input), allow field access and return Unknown.
    // This supports patterns like (get $input :paramName) where $input is dynamically typed.
    const resolved = applyType(yield* Ref.get(ctx.subst), recT);
    if (resolved._tag === "TCon" && resolved.name === "Unknown") {
      return tUnknown;
    }

    if (resolved._tag === "TApp" && resolved.con._tag === "TCon" && resolved.con.name === "Map") {
      const key = TCon(expr.label.startsWith(":") ? expr.label : JSON.stringify(expr.label.startsWith("\0str:") ? expr.label.slice(5) : expr.label));
      yield* assignType(key,resolved.args[0]!,originOf(expr,"map-key"));
      return TApp(TCon("Option"),[resolved.args[1]!]);
    }
    // The record type should be { label: resultT | restRow }
    const resultT = yield* ctx.freshTVar;
    const restRow = yield* ctx.freshRowVar;
    const expectedRecT = TRow(RExtend(expr.label, resultT, restRow));

    yield* unify(resolved, expectedRecT, originOf(expr, "get"));

    const s = yield* Ref.get(ctx.subst);
    return applyType(s, resultT);
  });
