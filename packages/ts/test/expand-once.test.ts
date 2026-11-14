import { Effect } from "effect";
import { describe, expect, it } from "vitest";

import { defaultBuiltins } from "../src/builtins/index.js";
import { expandMacroOnce, expandProgramSync, getPreludeEnvSync } from "../src/Expander.js";
import { formatSExpr } from "../src/Formatter.js";
import { parseManyToSExpr, type SExpr } from "../src/reader/index.js";

const read = (source: string) => Effect.runSync(parseManyToSExpr(source))[0]!;
const print = (expr: SExpr) => formatSExpr(expr).replace(/\s+/g, " ").trim();
const env = getPreludeEnvSync(defaultBuiltins);

/** Expand the leftmost-outermost macro call once. */
function step(expr: SExpr): SExpr | undefined {
  const once = expandMacroOnce(expr, env);
  if (once) return once.expr;
  if (expr._tag !== "List" || (expr.items[0]?._tag === "Sym" && expr.items[0].name === "quote")) return undefined;
  for (let index = 0; index < expr.items.length; index++) {
    const next = step(expr.items[index]!);
    if (next) return { ...expr, items: expr.items.map((item, at) => (at === index ? next : item)) };
  }
  return undefined;
}

describe("expandMacroOnce", () => {
  it("runs one macro and leaves the macro calls it produces unexpanded", () => {
    const once = expandMacroOnce(read("(when (and a b) x)"), env);
    expect(once?.macro).toBe("when");
    expect(print(once!.expr)).toBe("(if (and a b) (do x) nil)");
    expect(expandMacroOnce(read("(if a b c)"), env)).toBeUndefined();
  });

  it("reaches the full expansion when repeated", () => {
    let expr = read("(when (and a b) (-> x (f 1)))");
    for (let steps = 0; steps < 20; steps++) expr = step(expr) ?? expr;
    const full = expandProgramSync([read("(when (and a b) (-> x (f 1)))")], { builtins: defaultBuiltins }).exprs[0]!;
    expect(print(expr)).toBe(print(full));
  });
});
