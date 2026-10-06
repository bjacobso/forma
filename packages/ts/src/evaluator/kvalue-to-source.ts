/**
 * KValue → Lisp Source String
 *
 * Converts kernel values back to parseable Lisp source text.
 * Used by the compiler's inline expansion pass to replace evaluated
 * kernel calls with their results.
 *
 * @module
 */

import type { KValue } from "./types.js";
import { isKFn, isKSExpr, isKMacro, isKMap, isKList, isKMeta, isKKeyword, isKSymbol, mapKeyValue } from "./types.js";

/**
 * Convert a KValue to a parseable Lisp source string.
 *
 * @example
 * ```typescript
 * printKValue(42)           // "42"
 * printKValue("hello")      // '"hello"'
 * printKValue(":keyword")   // ":keyword"
 * printKValue(true)         // "true"
 * printKValue(null)         // "nil"
 * printKValue([1, 2, 3])    // "[1 2 3]"
 * printKValue(new Map([[":a", 1]])) // "{:a 1}"
 * ```
 */
export function printKValue(value: KValue): string {
  if (isKKeyword(value) || isKSymbol(value)) return value.name;
  if (value === null) return "nil";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") return String(value);
  if (typeof value === "string") {
    // Keywords (start with :) are printed as bare symbols
    return `"${escapeString(value)}"`;
  }
  if (isKFn(value)) {
    // Functions can't be round-tripped to source
    return "nil";
  }
  if (isKSExpr(value)) {
    return printSExpr(value.expr);
  }
  if (isKMacro(value)) {
    return "nil";
  }
  if (isKMeta(value)) {
    const entries = value.entries.map(
      ([slot, values]) => `[${[printKValue(slot), ...values.map(printKValue)].join(" ")}]`,
    );
    return `(meta ${entries.join(" ")})`;
  }
  if (isKMap(value)) {
    const entries: string[] = [];
    for (const [k, v] of value) {
      entries.push(`${printKValue(mapKeyValue(k))} ${printKValue(v)}`);
    }
    return `{${entries.join(" ")}}`;
  }
  if (isKList(value)) {
    return `[${value.map(printKValue).join(" ")}]`;
  }
  return "nil";
}

/**
 * Convert an SExpr back to source text.
 */
function printSExpr(expr: import("../reader/types.js").SExpr): string {
  switch (expr._tag) {
    case "Num":
      return String(expr.value);
    case "Str":
      return `"${escapeString(expr.value)}"`;
    case "Bool":
      return expr.value ? "true" : "false";
    case "Sym":
      return expr.name;
    case "List":
      return `(${expr.items.map(printSExpr).join(" ")})`;
    case "Vector":
      return `[${expr.items.map(printSExpr).join(" ")}]`;
    case "Map": {
      const entries = expr.pairs.map(([k, v]) => `${printSExpr(k)} ${printSExpr(v)}`);
      return `{${entries.join(" ")}}`;
    }
    case "Set":
      return `{${expr.items.map(printSExpr).join(" ")}}`;
    case "Error":
      return "nil";
  }
}

export { printSExpr };

function escapeString(s: string): string {
  return s
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\n/g, "\\n")
    .replace(/\t/g, "\\t")
    .replace(/\r/g, "\\r");
}
