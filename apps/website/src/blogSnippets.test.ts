import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Effect } from "effect";
import { describe, expect, test } from "vitest";
import { evaluate, read, show } from "../../../docs/snippets/blog/in-the-beginning/01/lisp.ts";
import { expand, operators, sumTo } from "../../../docs/snippets/blog/in-the-beginning/01/programs.ts";
import { run } from "../../../docs/snippets/blog/in-the-beginning/01/schema.ts";

const repoRoot = resolve(import.meta.dirname, "../../..");
const lisp = (source: string) => show(evaluate(read(source)));

// The blog shows these snippets and quotes their results; keep both honest.
describe("blog: In the Beginning Was the List", () => {
  const page = readFileSync(resolve(repoRoot, "docs/blog/in-the-beginning/01-the-list.md"), "utf8");

  test("the page includes every snippet file", () => {
    for (const file of ["lisp.ts", "programs.ts", "schema.ts"]) {
      expect(page).toContain(`@/snippets/blog/in-the-beginning/01/${file}`);
    }
  });

  test("the evaluator", () => {
    expect(lisp("(+ 1 2)")).toBe("3");
    expect(lisp("(+ 1 (+ 2 3))")).toBe("6");
    expect(lisp("(* 2 (+ 3 4))")).toBe("14");
    expect(JSON.stringify(read("(+ 1 (+ 2 3))"))).toBe('[{"sym":"+"},1,[{"sym":"+"},2,3]]');
    expect(lisp("(quote (+ 1 2))")).toBe("(+ 1 2)");
    expect(() => lisp("(+ 1 (quote x))")).toThrow("+ expects numbers, got x");
    expect(() => lisp("(square 3)")).toThrow("square is not defined");
    expect(() => lisp("(+ 1")).toThrow("unexpected end of input");
    expect(() => lisp("(0 1)")).toThrow("0 is not an operator");
  });

  test("programs about programs", () => {
    expect([...operators(read("(+ 1 (* 2 3))"))]).toEqual(["+", "*"]);
    expect(show(sumTo(5))).toBe("(+ 1 2 3 4 5)");
    expect(show(evaluate(sumTo(100)))).toBe("5050");
    const program = read("(+ 1 (square (+ 2 3)))");
    expect(show(expand(program))).toBe("(+ 1 (* (+ 2 3) (+ 2 3)))");
    expect(show(evaluate(expand(program)))).toBe("26");
    expect(show(expand(read("(square 1 2)")))).toBe("(* 1 1)");
  });

  test("the schema version", () => {
    expect(Effect.runSync(run({ op: "add", left: 1, right: { op: "add", left: 2, right: 3 } }))).toBe(6);
    const error = Effect.runSync(Effect.flip(run({ op: "add", left: 1, right: "2" })));
    expect(error._tag).toBe("SchemaError");
    expect(error.message).toBe('Expected number | { readonly "op": "add", ... }\n  at ["right"]');
  });
});
