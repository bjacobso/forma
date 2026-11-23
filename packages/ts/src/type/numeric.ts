import { Effect, Ref } from "effect";
import { InferContext } from "./context.js";
import { applyType } from "./substitution.js";
import { TCon, type Type } from "./types.js";
import { typeMismatch } from "./diagnostic-types.js";
import { type Origin, InferenceError } from "./errors.js";
import { unify } from "./unify.js";

/** Numeric requirements survive generalization instead of fixing inputs to Float. */
export const requireNumeric = (type: Type, origin: Origin, siblings: readonly Type[] = []): Effect.Effect<void, InferenceError, InferContext> => Effect.gen(function* () {
  const ctx = yield* InferContext;
  const actual = applyType(yield* Ref.get(ctx.subst), type);
  if (actual._tag === "TVar") {
    yield* Ref.update(ctx.pendingConstraints, pending => [...pending, {constraint:{className:"$Numeric", args:[actual]}, origin}]);
  } else if (!(actual._tag === "TCon" && ["Int", "Float", "Unknown"].includes(actual.name))) {
    // Name the numeric type the other operands settled on; with none, either one.
    const subst = yield* Ref.get(ctx.subst);
    const known = siblings.map(s => applyType(subst, s)).filter(s => s._tag === "TCon" && (s.name === "Int" || s.name === "Float"));
    const expected = known.some(s => s._tag === "TCon" && s.name === "Float") ? "Float" : known.length ? "Int" : undefined;
    const mismatch = typeMismatch(TCon(expected ?? "Int"), actual);
    yield* ctx.fail(origin, {code:"typecheck/type-mismatch", ...mismatch,
      ...(expected ? {} : {expected:"Int or Float", message:`Expected Int or Float, found ${mismatch["got"]}`})});
  }
});

/** Int operands do not force an otherwise reusable numeric parameter to Int. */
export const numericResult = (types: readonly Type[], origin: Origin): Effect.Effect<Type, InferenceError, InferContext> => Effect.gen(function* () {
  const ctx = yield* InferContext;
  const subst = yield* Ref.get(ctx.subst);
  const args = types.map(type => applyType(subst, type));
  for (const arg of args) yield* requireNumeric(arg, origin);
  if (args.some(arg => arg._tag === "TCon" && arg.name === "Float")) return TCon("Float");
  const variables = args.filter(arg => arg._tag === "TVar");
  if (!variables.length) return TCon("Int");
  for (const variable of variables.slice(1)) yield* unify(variables[0]!, variable, origin);
  return variables[0]!;
});

export const solveNumeric = (defaultUnresolved = false): Effect.Effect<void, InferenceError, InferContext> => Effect.gen(function* () {
  const ctx = yield* InferContext;
  for (const pending of yield* Ref.get(ctx.pendingConstraints)) {
    if (pending.constraint.className !== "$Numeric") continue;
    const actual = applyType(yield* Ref.get(ctx.subst), pending.constraint.args[0]!);
    if (actual._tag === "TVar") {
      if (defaultUnresolved) yield* unify(actual, TCon("Int"), pending.origin);
    } else yield* requireNumeric(actual, pending.origin);
  }
});
