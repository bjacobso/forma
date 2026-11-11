import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "vitest";
import {
  checkModuleGraph,
  resolveModuleGraph,
  sourceModuleResolver,
  type ModuleSource,
} from "../src/Modules.js";

const root = resolve(import.meta.dirname, "../../..");
const fixture = resolve(root, "conformance/clojure-spellings");
const read = (path: string) => readFileSync(resolve(root, path), "utf8");
/** The library and its one dependency sit beside the fixtures they serve. */
const preludes: readonly ModuleSource[] = ["clojure.lisp", "kernel.lisp"].map(
  (name) => ({ id: name, source: read(`preludes/modules/${name}`) }),
);
const fixtureSource = (name: string) =>
  readFileSync(resolve(fixture, name), "utf8");
const check = (name: string) => {
  const entry = { id: name, source: fixtureSource(name) };
  return checkModuleGraph(
    resolveModuleGraph(entry, sourceModuleResolver([...preludes, entry])),
  );
};
/** `(-> Int (Option Int) String)` reads better than the nested arrays. */
const showType = (type: unknown): string =>
  Array.isArray(type) ? `(${type.map(showType).join(" ")})` : String(type);

describe("Clojure spellings (RFC 0021 stage 0)", () => {
  test("a module written with Clojure spellings typechecks and evaluates", () => {
    const result = check("orders.lisp");
    expect(result.diagnostics).toEqual([]);
    const exports = new Map(
      result.interfaces.at(-1)?.exports.map((e) => [e.name, e]),
    );
    expect(showType(exports.get("quote-for")?.scheme?.type)).toBe(
      "(-> Int (Option Int) String)",
    );
    expect(exports.get("receipt")?.data?.value).toBe("4400 cents");
  });

  // Spelling only: each Clojure habit below keeps Forma's meaning instead.
  test.each([
    ["truthiness.lisp", "Cannot unify Option<Int> with Bool", "coupon"],
    ["nil-punning.lisp", "Type mismatch: Unit vs Int", "nil"],
    [
      "keyword-access.lisp",
      "Cannot unify :customer with",
      "(:customer order)",
    ],
  ])("%s is rejected at the author's span", (name, message, text) => {
    const source = fixtureSource(name);
    const [diagnostic, ...rest] = check(name).diagnostics;
    expect(rest).toEqual([]);
    expect(diagnostic?.code).toBe("typecheck/type-mismatch");
    expect(diagnostic?.message).toContain(message);
    expect(diagnostic?.span?.sourceId).toBe(name);
    expect(
      source.slice(diagnostic!.span!.startOffset, diagnostic!.span!.endOffset),
    ).toBe(text);
  });

  // A gap, pinned so that fixing it is visible: the arity failure escapes
  // macro expansion as an exception instead of a located diagnostic.
  test("a multi-arity defn is rejected without an author diagnostic", () => {
    expect(() => check("multi-arity.lisp")).toThrow(
      expect.objectContaining({ _tag: "ArityError", message: "fn expects 2+ arguments, got 0" }),
    );
  });

  test("the library is only in scope where a module imports it", () => {
    const entry = { id: "unclaimed.lisp", source: "(defn f [x] x)" };
    expect(() =>
      checkModuleGraph(
        resolveModuleGraph(entry, sourceModuleResolver([...preludes, entry])),
      ),
    ).toThrow(/Use define instead of defn/);
  });
});
