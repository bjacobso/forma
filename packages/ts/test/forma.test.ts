import { describe, expect, test } from "vitest";
import { Effect, Result } from "effect";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Builtins, Elaboration, Evaluator, Formatter, Reader, Type } from "../src/index.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturesDir = resolve(__dirname, "fixtures/language-features");

const PreludeLive = Evaluator.makePreludeLayer(Builtins.defaultBuiltins);
const opts: Evaluator.KernelOptions = {
  stepLimit: 50_000,
  builtins: Builtins.defaultBuiltins,
};

const run = (source: string) =>
  Effect.runPromise(Effect.provide(Evaluator.evaluate(source, opts), PreludeLive)).then(
    (r) => r.value,
  );

const runFixture = (name: string) => run(readFileSync(join(fixturesDir, name), "utf8"));

describe("@formalang/ts reader and formatter", () => {
  test("parses S-expressions with maps, vectors, and source locations", () => {
    const expr = Effect.runSync(Reader.parseToSExpr('(entity Worker {:name "Maria" :active true})'));
    expect(expr._tag).toBe("List");
    if (expr._tag === "List") {
      expect(expr.items[0]).toMatchObject({ _tag: "Sym", name: "entity" });
      expect(expr.items[2]?._tag).toBe("Map");
      expect(expr.loc.start).toBe(0);
    }
  });

  test("formats multiple top-level forms canonically", () => {
    const result = Effect.runSync(Formatter.formatLispSource("(define x 1)  (+ x 2)"));
    expect(result).toBe("(define x 1)\n(+ x 2)\n");
  });

  test("returns a typed parse failure through Effect 4", () => {
    const result = Effect.runSync(Effect.result(Reader.parseToSExpr("(unclosed")));
    expect(Result.isFailure(result)).toBe(true);
    if (Result.isFailure(result)) expect(result.failure).toBeInstanceOf(Reader.ParseError);
  });
});

describe("@formalang/ts evaluator fixtures", () => {
  test("arithmetic + let fixture", async () => {
    const result = (await runFixture("arithmetic-let.lisp")) as ReadonlyMap<
      string,
      Evaluator.KValue
    >;
    expect(result.get(":revenue")).toBe(6000);
    expect(result.get(":cost")).toBe(4000);
    expect(result.get(":margin")).toBe(2000);
    expect(result.get(":margin-pct")).toBe(33);
  });

  test("closures + map fixture", async () => {
    expect(await runFixture("closures-map.lisp")).toEqual([3, 6, 9, 12]);
  });

  test("cond branching fixture", async () => {
    expect(await runFixture("cond-grades.lisp")).toEqual(["A", "B", "C", "D", "F"]);
  });

  test("a let among a call's operands leaves the other operands in place", async () => {
    expect(await run("[1 (let [x 2] x) 3]")).toEqual([1, 2, 3]);
    expect(await run("((fn [w] w) (let [u 7] u))")).toBe(7);
    expect(await run("(define (h a b) (+ a b))\n(h (let [x 1 y 2] (+ x y)) 10)")).toBe(13);
    expect(await run("(define (g) [1 (let [x 2] x) 3])\n(g)")).toEqual([1, 2, 3]);
  });
});

describe("@formalang/ts elaboration", () => {
  test("compiles through an Effect 4 prelude service", async () => {
    const result = await Effect.runPromise(
      Effect.provide(Elaboration.compile("42", { builtins: Builtins.defaultBuiltins }), PreludeLive),
    );
    expect(result.errors).toEqual([]);
    expect(result.results).toEqual([{ kind: "value", value: 42 }]);
  });
});

describe("@formalang/ts type inference", () => {
  test("infers primitive and function types", async () => {
    expect(await Effect.runPromise(Type.inferSourceStr("42"))).toBe("Number");
    expect(await Effect.runPromise(Type.inferSourceStr("(fn [x] (+ x 1))"))).toBe(
      "Number -> Number",
    );
  });

  test("typechecks copied Lisp fixtures", async () => {
    expect(
      await Effect.runPromise(
        Type.inferSourceStr(readFileSync(join(fixturesDir, "arithmetic-let.lisp"), "utf8")),
      ),
    ).toBe("{:revenue: Number, :cost: Number, :margin: Number, :margin-pct: Number}");
    expect(
      await Effect.runPromise(
        Type.inferSourceStr(readFileSync(join(fixturesDir, "closures-map.lisp"), "utf8")),
      ),
    ).toBe("List<Number>");
    expect(
      await Effect.runPromise(
        Type.inferSourceStr(readFileSync(join(fixturesDir, "cond-grades.lisp"), "utf8")),
      ),
    ).toBe("List<String>");
  });

  test("rejects inconsistent branch types", async () => {
    const err = await Effect.runPromise(Effect.flip(Type.inferSource('(if true 1 "two")')));
    expect(err).toBeInstanceOf(Type.InferenceError);
  });
});
