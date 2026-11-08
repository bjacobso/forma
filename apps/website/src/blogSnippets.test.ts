import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Effect, Schema } from "effect";
import { describe, expect, test } from "vitest";
import { evaluate, read, show } from "../../../docs/snippets/blog/in-the-beginning/01/lisp.ts";
import { expand, operators, sumTo } from "../../../docs/snippets/blog/in-the-beginning/01/programs.ts";
import { run } from "../../../docs/snippets/blog/in-the-beginning/01/schema.ts";
import { display, evaluate as evaluate2 } from "../../../docs/snippets/blog/in-the-beginning/02/evaluate.ts";
import { ExprFromSexp, parse } from "../../../docs/snippets/blog/in-the-beginning/02/expr.ts";
import { read as read2, render } from "../../../docs/snippets/blog/in-the-beginning/02/read.ts";
import { show as show2 } from "../../../docs/snippets/blog/in-the-beginning/02/sexp.ts";

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

describe("blog: And the List Became Schema", () => {
  const page = readFileSync(resolve(repoRoot, "docs/blog/in-the-beginning/02-list-became-schema.md"), "utf8");
  const diagnostic = (source: string) => Effect.runSync(Effect.flip(parse(source)));
  const rendered = (source: string) => render(source, diagnostic(source));
  const run2 = (source: string) => display(evaluate2(Effect.runSync(parse(source))));

  test("the page includes every snippet file", () => {
    for (const file of ["sexp.ts", "read.ts", "expr.ts", "evaluate.ts"]) {
      expect(page).toContain(`@/snippets/blog/in-the-beginning/02/${file}`);
    }
  });

  test("Part 1's behavior that the post contrasts with", () => {
    expect(() => lisp("(+ 1 (* 2 3)")).toThrow("unexpected end of input");
    expect(lisp("(quote x y)")).toBe("x");
  });

  test("reading attaches spans and blames the unclosed paren", () => {
    const sexp = Effect.runSync(read2("(+ 1 x)"));
    expect(sexp._tag === "List" && sexp.items[1]).toEqual({ _tag: "Num", value: 1, span: { start: 3, end: 4 } });
    expect(rendered("(+ 1 (* 2 3)")).toBe("error: this ( is never closed\n1 | (+ 1 (* 2 3)\n  | ^");
    expect(diagnostic("(+ 1 2))").message).toBe("unexpected )");
  });

  test("parsing reports meaningless shapes at their source", () => {
    expect(rendered("(+ 1 (quote x y))")).toBe(
      "error: quote takes exactly one argument\n1 | (+ 1 (quote x y))\n  |      ^^^^^^^^^^^",
    );
    expect(rendered("(+ 1 (2 3))")).toBe("error: 2 is not an operator\n1 | (+ 1 (2 3))\n  |       ^");
    expect(rendered("(+ 1 ())")).toBe("error: () is not an expression\n1 | (+ 1 ())\n  |      ^^");
    expect(rendered("(+ 1\n   (quote a b))")).toBe(
      "error: quote takes exactly one argument\n2 |    (quote a b))\n  |    ^^^^^^^^^^^",
    );
    expect(diagnostic("(+ 1 (quote x y))")).toEqual({
      message: "quote takes exactly one argument",
      span: { start: 5, end: 16 },
    });
  });

  test("untrusted trees fail with a path, and encoding prints", () => {
    const json = {
      _tag: "List",
      items: [{ _tag: "Num", value: "1", span: { start: 1, end: 2 } }],
      span: { start: 0, end: 3 },
    };
    const error = Effect.runSync(Effect.flip(Schema.decodeUnknownEffect(ExprFromSexp)(json)));
    expect(error.message).toBe('Expected number\n  at ["items"][0]["value"]');
    const expr = Effect.runSync(parse("(+   1\n  (quote   (a b)))"));
    expect(show2(Schema.encodeSync(ExprFromSexp)(expr))).toBe("(+ 1 (quote (a b)))");
  });

  test("the smaller evaluator", () => {
    expect(run2("(+ 1 2)")).toBe("3");
    expect(run2("(+ 1 (+ 2 3))")).toBe("6");
    expect(run2("(quote (+ 1 2))")).toBe("(+ 1 2)");
    expect(() => run2("(+ 1 (quote x))")).toThrow("+ expects numbers, got x");
    expect(() => run2("x")).toThrow("x is not defined");
  });
});
