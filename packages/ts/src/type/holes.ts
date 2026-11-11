import { Effect, Ref } from "effect";
import { authorNames } from "../diagnostic/diagnostic.js";
import { InferContext } from "./context.js";
import { showDiagnosticType } from "./diagnostic-types.js";
import { originOf } from "./infer-core.js";
import { instantiate } from "./scheme-ops.js";
import { applyEnv, applyType } from "./substitution.js";
import { ftvType, frvType, fevType } from "./types.js";
import { unify } from "./unify.js";

/** Inspect lowered expressions only: quoted data and patterns are not variables. */
export function hasHoles(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(hasHoles);
  if (!value || typeof value !== "object") return false;
  const node = value as Record<string, unknown>;
  if (node._tag === "Var" && typeof node.name === "string") return node.name.startsWith("?");
  if (node._tag === "LQuoted") return false;
  return Object.entries(node).some(([key, child]) => key !== "span" && key !== "signature" && hasHoles(child));
}

/** Binding-only search. Each trial restores the solver, including failed trials. */
export const reportHoles = Effect.gen(function* () {
  const ctx = yield* InferContext;
  const subst = yield* Ref.get(ctx.subst);
  for (const hole of yield* Ref.get(ctx.holes)) {
    const target = applyType(subst, hole.type);
    const visible = new Set<string>();
    const bindings = [...applyEnv(subst, hole.env)].reverse().filter(([name, scheme]) => {
      const authored = authorNames(name);
      if (visible.has(authored)) return false;
      visible.add(authored);
      return !name.startsWith("?") && !name.startsWith("__") && !scheme.constraints?.length;
    });
    bindings.sort(([a, sa], [b, sb]) => {
      const generality = (s: typeof sa) => ftvType(s.type).size + frvType(s.type).size + fevType(s.type).size;
      return Number(hole.globals.has(a)) - Number(hole.globals.has(b)) || generality(sa) - generality(sb) || authorNames(a).localeCompare(authorNames(b));
    });
    const candidates: string[] = [];
    for (const [binding, scheme] of bindings) {
      const name = authorNames(binding);
      if (name.includes("__forma_") || candidates.includes(name)) continue;
      const trial = yield* Effect.result(Effect.gen(function* () {
        const candidate = yield* instantiate(scheme);
        yield* unify(candidate, target, originOf(hole.expr, "hole-candidate"));
      }));
      yield* Ref.set(ctx.subst, subst);
      if (trial._tag === "Success") candidates.push(name);
      if (candidates.length === 10) break;
    }
    const name = authorNames(hole.expr.name);
    const expected = showDiagnosticType(target);
    yield* ctx.addDiagnostic({
      code: "typecheck/hole", severity: "error", source: "hm", span: hole.expr.span,
      message: `Hole ${name} needs ${expected}; candidates: ${candidates.length ? candidates.join(", ") : "none"}`,
      details: { name, expected, candidates },
    });
  }
  yield* Ref.set(ctx.holes, []);
});
