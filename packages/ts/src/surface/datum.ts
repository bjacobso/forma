import { numericDatum } from "../evaluator/types.js";
import type { SExpr } from "../reader/types.js";
import { KKeyword, KSymbol, mapKey, type KValue } from "../evaluator/types.js";

// Syntax holes are usable as ordinary data while retaining their authored
// list/vector distinction and location for subsequent validation.
const syntax = new WeakMap<object, SExpr>();

export const syntaxForDatum = (value: KValue): SExpr | undefined =>
  value !== null && typeof value === "object" ? syntax.get(value) : undefined;

export function datum(expr: SExpr): KValue {
  let value: KValue;
  switch (expr._tag) {
    case "Num": return numericDatum(expr);
    case "Str": case "Bool": return expr.value;
    case "Sym": return expr.name === "nil" ? null : expr.name.startsWith(":") ? KKeyword(expr.name) : KSymbol(expr.name);
    case "List": case "Vector": value = expr.items.map(datum); break;
    case "Map": value = new Map(expr.pairs.map(([k, v]) => [mapKey(datum(k))!, datum(v)])); break;
    default: throw new Error(`Invalid form datum ${expr._tag}`);
  }
  syntax.set(value, expr);
  return value;
}
