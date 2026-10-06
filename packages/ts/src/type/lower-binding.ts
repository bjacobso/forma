/**
 * Binding forms: fn, let, define, do.
 */
import type { SExpr } from "../reader/index.js";
import { asVector, bindingPairs, headSym } from "../reader/types.js";
import type { CoreExpr, Span } from "./core-expr.js";
import { CLit, CVar, CLam, CLet, CEffectDo, CDef, LNil, mkParam, mkBinding } from "./core-expr.js";
import { InferenceError } from "./errors.js";
import type { LowerFn } from "./lower-core.js";
import { spanOf, freshInternalBinding } from "./lower-core.js";
import { lowerMapDestructure, lowerSeqDestructure } from "./lower-destructure.js";

export function lowerFn(lower: LowerFn, span: Span, items: readonly SExpr[]): CoreExpr {
  if (items.length < 3) {
    throw new InferenceError({ message: "fn requires parameters and body" });
  }
  const paramsItems = asVector(items[1]!, "fn params");

  const params: ReturnType<typeof mkParam>[] = [];
  let restParam: ReturnType<typeof mkParam> | undefined;
  const destructureBindings: ReturnType<typeof mkBinding>[] = [];

  for (let pi = 0; pi < paramsItems.length; pi++) {
    const p = paramsItems[pi]!;
    if (p._tag === "Sym" && p.name === "&") {
      const nextP = paramsItems[pi + 1];
      if (!nextP || nextP._tag !== "Sym") {
        throw new InferenceError({
          message: "& must be followed by a rest parameter name",
        });
      }
      if (pi + 2 !== paramsItems.length) {
        throw new InferenceError({
          message: "rest parameter must be the final fn parameter",
        });
      }
      restParam = mkParam(spanOf(nextP), nextP.name);
      break;
    }

    if (p._tag === "Sym") {
      params.push(mkParam(spanOf(p), p.name));
    } else if (p._tag === "Map") {
      const placeholder = `__destructure_${pi}`;
      params.push(mkParam(spanOf(p), placeholder));
      lowerMapDestructure(spanOf(p), p, CVar(spanOf(p), placeholder), destructureBindings);
    } else if (p._tag === "Vector") {
      const placeholder = `__destructure_${pi}`;
      params.push(mkParam(spanOf(p), placeholder));
      lowerSeqDestructure(spanOf(p), p, CVar(spanOf(p), placeholder), destructureBindings);
    } else {
      throw new InferenceError({
        message: "fn param must be a symbol, map destructure, or vector destructure",
      });
    }
  }

  // Multiple body forms -> implicit do (lower to last-wins)
  let body = items.length === 3 ? lower(items[2]!) : lowerDoBody(lower, span, items.slice(2));

  // Wrap body in let for destructuring bindings
  if (destructureBindings.length > 0) {
    body = CLet(span, destructureBindings, body);
  }

  return CLam(span, params, body, restParam);
}

export function lowerLet(lower: LowerFn, span: Span, items: readonly SExpr[]): CoreExpr {
  if (items.length < 3) {
    throw new InferenceError({ message: "let requires bindings and body" });
  }
  const pairs = bindingPairs(items[1]!, "let");

  if (pairs.some(({ value }) => effectBindValue(value) !== undefined)) {
    const bodyItems = items.slice(2);
    return lowerLetWithEffectBindings(lower, span, pairs, bodyItems);
  }

  const bindings: ReturnType<typeof mkBinding>[] = [];
  for (const { name: nameSym, value: valRaw } of pairs) {
    const valExpr = lower(valRaw);

    if (nameSym._tag === "Sym") {
      bindings.push(mkBinding(spanOf(nameSym), nameSym.name, valExpr));
    } else if (nameSym._tag === "Map") {
      // Map destructuring: bind value to placeholder, then extract keys
      const placeholder = freshInternalBinding("destructure_let");
      const placeholderExpr = CVar(spanOf(nameSym), placeholder);
      bindings.push(mkBinding(spanOf(nameSym), placeholder, valExpr));
      lowerMapDestructure(spanOf(nameSym), nameSym, placeholderExpr, bindings);
    } else if (nameSym._tag === "Vector") {
      // Sequential destructuring: bind value to placeholder, then extract elements
      const placeholder = freshInternalBinding("destructure_let");
      const placeholderExpr = CVar(spanOf(nameSym), placeholder);
      bindings.push(mkBinding(spanOf(nameSym), placeholder, valExpr));
      lowerSeqDestructure(spanOf(nameSym), nameSym, placeholderExpr, bindings);
    } else {
      throw new InferenceError({
        message: "let binding name must be a symbol, map destructure, or vector destructure",
      });
    }
  }

  const body = items.length === 3 ? lower(items[2]!) : lowerDoBody(lower, span, items.slice(2));
  return CLet(span, bindings, body);
}

function lowerLetWithEffectBindings(
  lower: LowerFn,
  span: Span,
  pairs: readonly { readonly name: SExpr; readonly value: SExpr }[],
  bodyItems: readonly SExpr[],
): CoreExpr {
  if (pairs.length === 0) {
    return bodyItems.length === 1 ? lower(bodyItems[0]!) : lowerDoBody(lower, span, bodyItems);
  }

  const [first, ...rest] = pairs;
  const effectValue = effectBindValue(first!.value);
  const body = lowerLetWithEffectBindings(lower, span, rest, bodyItems);

  if (effectValue !== undefined) {
    if (first!.name._tag !== "Sym") {
      throw new InferenceError({
        message: "<- let binding name must be a symbol",
      });
    }
    return CEffectDo(
      span,
      [mkBinding(spanOf(first!.name), first!.name.name, lower(effectValue))],
      body,
    );
  }

  const value = lower(first!.value);
  if (first!.name._tag === "Sym") {
    return CLet(span, [mkBinding(spanOf(first!.name), first!.name.name, value)], body);
  }

  if (first!.name._tag === "Map") {
    const placeholder = freshInternalBinding("destructure_let");
    const placeholderExpr = CVar(spanOf(first!.name), placeholder);
    const bindings = [mkBinding(spanOf(first!.name), placeholder, value)];
    lowerMapDestructure(spanOf(first!.name), first!.name, placeholderExpr, bindings);
    return CLet(span, bindings, body);
  }

  if (first!.name._tag === "Vector") {
    const placeholder = freshInternalBinding("destructure_let");
    const placeholderExpr = CVar(spanOf(first!.name), placeholder);
    const bindings = [mkBinding(spanOf(first!.name), placeholder, value)];
    lowerSeqDestructure(spanOf(first!.name), first!.name, placeholderExpr, bindings);
    return CLet(span, bindings, body);
  }

  throw new InferenceError({
    message: "let binding name must be a symbol, map destructure, or vector destructure",
  });
}

function effectBindValue(expr: SExpr): SExpr | undefined {
  if (
    expr._tag === "List" &&
    expr.items.length === 2 &&
    expr.items[0]!._tag === "Sym" &&
    expr.items[0]!.name === "<-"
  ) {
    return expr.items[1]!;
  }
  return undefined;
}

export function lowerDef(lower: LowerFn, span: Span, items: readonly SExpr[]): CoreExpr {
  if (items.length < 3) {
    throw new InferenceError({ message: "define requires a name and value" });
  }
  const nameExpr = items[1]!;

  if (nameExpr._tag === "Sym") {
    if (items.length !== 3) {
      throw new InferenceError({ message: "define requires exactly a name and value" });
    }
    return CDef(span, nameExpr.name, lower(items[2]!));
  }

  if (nameExpr._tag === "List") {
    const fnName = headSym(nameExpr);
    if (!fnName) {
      throw new InferenceError({ message: "define function head must start with a symbol" });
    }
    const paramsExpr = {
      _tag: "Vector" as const,
      items: nameExpr.items.slice(1),
      loc: nameExpr.loc,
    };
    const fnForm = {
      _tag: "List" as const,
      items: [
        { _tag: "Sym" as const, name: "fn", loc: nameExpr.loc },
        paramsExpr,
        ...items.slice(2),
      ],
      loc: nameExpr.loc,
    };
    return CDef(span, fnName, lower(fnForm));
  }

  throw new InferenceError({ message: "define name must be a symbol or function head" });
}

export function lowerDo(lower: LowerFn, span: Span, items: readonly SExpr[]): CoreExpr {
  if (items.length === 1) return CLit(span, LNil);
  return lowerDoBody(lower, span, items.slice(1));
}

export function lowerEffectDo(lower: LowerFn, span: Span, items: readonly SExpr[]): CoreExpr {
  if (items.length < 3) {
    throw new InferenceError({ message: "do! requires bindings and body" });
  }
  const vector=items[1];
  if (vector?._tag === "Vector") {
    const pureAt=vector.items.findIndex((value,index)=>index%2===0 && value._tag==="Sym" && value.name===":let");
    if (pureAt>=0) {
      const pure=vector.items[pureAt+1];
      if (pure?._tag!=="Vector" || pure.items.length%2) throw new InferenceError({message:":let requires binding/value pairs"});
      const rest:SExpr={_tag:"List",loc:vector.loc,items:[items[0]!,{...vector,items:vector.items.slice(pureAt+2)},...items.slice(2)]};
      const scoped:SExpr={_tag:"List",loc:pure.loc,items:[{_tag:"Sym",loc:pure.loc,name:"let"},pure,rest]};
      return lowerEffectDo(lower,span,[items[0]!,{...vector,items:vector.items.slice(0,pureAt)},scoped]);
    }
  }
  const pairs = bindingPairs(items[1]!, "do!");
  const bindings = pairs.map(({ name: nameSym, value }) => {
    if (nameSym._tag !== "Sym") {
      throw new InferenceError({ message: "do! binding name must be a symbol" });
    }
    return mkBinding(spanOf(nameSym), nameSym.name, lower(effectBindValue(value) ?? value));
  });
  const body = items.length === 3 ? lower(items[2]!) : lowerDoBody(lower, span, items.slice(2));
  return CEffectDo(span, bindings, body);
}

/** Lower a sequence of body forms into nested lets (all but last are discarded) */
export function lowerDoBody(lower: LowerFn, span: Span, items: readonly SExpr[]): CoreExpr {
  if (items.length === 0) return CLit(span, LNil);

  const [first, ...rest] = items;
  const effectValue = effectBindValue(first!);
  if (effectValue !== undefined) {
    const name = freshInternalBinding("effect_bind");
    const body = rest.length === 0 ? CVar(spanOf(first!), name) : lowerDoBody(lower, span, rest);
    return CEffectDo(span, [mkBinding(spanOf(first!), name, lower(effectValue))], body);
  }

  if (rest.length === 0) return lower(first!);

  const body = lowerDoBody(lower, span, rest);
  return CLet(span, [mkBinding(spanOf(first!), freshInternalBinding("do"), lower(first!))], body);
}
