import { mapKey } from "../evaluator/types.js";
/**
 * Control flow forms: if, match, get, ascribe.
 */
import type { SExpr } from "../reader/index.js";
import { trySym, asSym, asList, headSym } from "../reader/types.js";
import type { CoreExpr, Span } from "./core-expr.js";
import {
  CLit,
  CIf,
  CGet,
  CAscribe,
  CMatch,
  CEffectFail,
  CEffectCatch,
  LNil,
  mkParam,
} from "./core-expr.js";
import { InferenceError } from "./errors.js";
import { spanOf, type LowerFn } from "./lower-core.js";
import { lowerDoBody } from "./lower-binding.js";
import { parseTypeExpr } from "./type-parser.js";

export function lowerIf(lower: LowerFn, span: Span, items: readonly SExpr[]): CoreExpr {
  if (items.length < 3 || items.length > 4) {
    throw new InferenceError({ message: "if requires 2-3 arguments" });
  }
  const cond = lower(items[1]!);
  const then = lower(items[2]!);
  const else_ = items.length === 4 ? lower(items[3]!) : CLit(span, LNil);
  return CIf(span, cond, then, else_);
}

export function lowerWhen(lower: LowerFn, span: Span, items: readonly SExpr[]): CoreExpr {
  if (items.length < 2) {
    throw new InferenceError({ message: "when expects a condition and zero or more body forms" });
  }
  const cond = lower(items[1]!);
  const then =
    items.length === 2
      ? CLit(span, LNil)
      : items.length === 3
        ? lower(items[2]!)
        : lowerDoBody(lower, span, items.slice(2));
  return CIf(span, cond, then, CLit(span, LNil));
}

export function lowerUnless(lower: LowerFn, span: Span, items: readonly SExpr[]): CoreExpr {
  if (items.length < 2) {
    throw new InferenceError({
      message: "unless expects a condition and zero or more body forms",
    });
  }
  const cond = lower(items[1]!);
  const else_ =
    items.length === 2
      ? CLit(span, LNil)
      : items.length === 3
        ? lower(items[2]!)
        : lowerDoBody(lower, span, items.slice(2));
  return CIf(span, cond, CLit(span, LNil), else_);
}

export function lowerMatch(lower: LowerFn, span: Span, items: readonly SExpr[]): CoreExpr {
  if (items.length < 4 || (items.length - 2) % 2 !== 0) {
    throw new InferenceError({
      message: "(match scrutinee (Pat vars) body ...) requires scrutinee and pattern/body pairs",
    });
  }

  const scrutinee = lower(items[1]!);
  const arms: import("./core-expr.js").MatchArm[] = [];

  for (let i = 2; i < items.length; i += 2) {
    const patExpr = items[i]!;
    const bodyExpr = items[i + 1]!;

    const patSym = trySym(patExpr);
    const conHead = headSym(patExpr);
    const simple = patExpr._tag === "List" && patExpr.items.slice(1).every(v => v._tag === "Sym" && /^[a-z_]/.test(v.name));
    const pattern: import("./core-expr.js").Pattern = patSym === "_" ? { _tag: "PWild" }
      : conHead && /^[A-Z]/.test(conHead) && simple ? { _tag: "PCon", name: conHead, vars: asList(patExpr, "pattern").slice(1).map(v => asSym(v, "binder")) }
      : patSym && /^[A-Z]/.test(patSym) ? { _tag: "PCon", name: patSym, vars: [] }
      : { _tag: "PData", syntax: patExpr };

    arms.push({ pattern, body: lower(bodyExpr) });
  }

  return CMatch(span, scrutinee, arms);
}

export function lowerGet(lower: LowerFn, span: Span, items: readonly SExpr[]): CoreExpr {
  if (items.length !== 3) {
    throw new InferenceError({ message: "get requires a record and a label" });
  }
  const record = lower(items[1]!);
  const labelExpr = items[2]!;
  const label = labelExpr._tag === "Sym" && labelExpr.name.startsWith(":") ? labelExpr.name : labelExpr._tag === "Str" ? mapKey(labelExpr.value)! : undefined;
  return label === undefined ? { ...CGet(span, record, ""), key: lower(labelExpr) } : CGet(span, record, label);
}

export function lowerAscribe(lower: LowerFn, span: Span, items: readonly SExpr[]): CoreExpr {
  if (items.length !== 3) {
    throw new InferenceError({ message: "(: expr Type) requires exactly 2 arguments" });
  }
  const expr = lower(items[1]!);
  const typeExpr = parseTypeExpr(items[2]!);
  return CAscribe(span, expr, typeExpr);
}

export function lowerEffectFail(lower: LowerFn, span: Span, items: readonly SExpr[]): CoreExpr {
  const error = items[1];
  if (
    items.length !== 2 ||
    error?._tag !== "List" ||
    error.items.length !== 2 ||
    error.items[0]?._tag !== "Sym"
  ) {
    throw new InferenceError({
      message: "fail expects a constructed error value: (fail (ErrorName payload)).",
    });
  }
  return CEffectFail(span, error.items[0].name, lower(error.items[1]!));
}

export function lowerEffectCatch(lower: LowerFn, span: Span, items: readonly SExpr[]): CoreExpr {
  const pattern = items[2];
  if (
    items.length !== 4 ||
    pattern?._tag !== "List" ||
    pattern.items.length !== 2 ||
    pattern.items[0]?._tag !== "Sym" ||
    pattern.items[1]?._tag !== "Sym"
  ) {
    throw new InferenceError({
      message: "catch expects (catch effect (ErrorName binding) handler).",
    });
  }
  return CEffectCatch(
    span,
    lower(items[1]!),
    pattern.items[0].name,
    mkParam(spanOf(pattern.items[1]), pattern.items[1].name),
    lower(items[3]!),
  );
}
