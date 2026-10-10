import { describe, expect, it } from "vitest";
import { Effect } from "effect";
import { createRequire } from "node:module";
import ts from "typescript";
import { lower } from "../src/type/lower-core.js";
import { normalizeCoreProgram } from "../src/surface/core.js";
import { Reader, Evaluator, Builtins, Type, Formatter, Syntax, Editor, Mechanics } from "../src/index.js";

const builtins = Builtins.defaultBuiltins;
const forms = (source: string) => Reader.toSExprMany(Reader.parse(source).redTree);
const run = (source: string, interpreter = false) => Effect.runSync(
  (interpreter ? Evaluator.evaluateCompileTimeExprs : Evaluator.evaluateExprs)(interpreter ? normalizeCoreProgram(forms(source)) : forms(source), { builtins, stepLimit: 100_000 }),
).value;

const values = [
  ["1.0", "Float", "1.0"], ["1e0", "Float", "1.0"], ["1", "Int", "1"],
  ["(+ 1 2)", "Int", "3"], ["(+ 1.0 2)", "Float", "3.0"],
  ["(* 2.0 3)", "Float", "6.0"], ["(- 4.0)", "Float", "-4.0"],
  ["(- 5.0 2 1)", "Float", "2.0"], ["(/ 2)", "Float", "2.0"], ["(/ 12 2 3)", "Float", "2.0"], ["(/ 6 3)", "Float", "2.0"],
  ["(min 2 3.0)", "Float", "2.0"], ["(max 2.0 3)", "Float", "3.0"],
  ["(abs -2.0)", "Float", "2.0"], ["(mod -5 2)", "Int", "-1"],
  ["(floor 2.0)", "Int", "2"], ["(ceil 2.1)", "Int", "3"], ["(round -1.5)", "Int", "-1"],
] as const;

describe("Int and Float semantics", () => {
  it.each(values)("types and evaluates %s", async (source, type, printed) => {
    expect(await Effect.runPromise(Type.inferSourceStr(source))).toBe(type);
    for (const interpreter of [false, true]) expect(Evaluator.printKValue(run(source, interpreter))).toBe(printed);
  });

  it("compares numeric values through patterns and nested collections", async () => {
    for (const interpreter of [false, true]) {
      expect(run("[(= 2 2.0) (= [2] [2.0]) (match 2.0 2 true _ false)]", interpreter)).toEqual([true, true, false]);
    }
    expect(await Effect.runPromise(Type.inferSourceStr("(match 2.0 2 true _ false)"))).toBe("Bool");
    await expect(Effect.runPromise(Type.inferSourceStr("(match 2 2.0 true _ false)"))).rejects.toThrow();
  });

  it("dispatches distinct Int and Float instances even for integral Float values", async () => {
    const source = '(typeclass (NumericLabel a) (: label (-> a String))) (instance (NumericLabel Int) (define label [x] "int")) (instance (NumericLabel Float) (define label [x] "float")) [(label 2) (label 2.0) (label (* 2.0 3))]';
    expect(await Effect.runPromise(Type.inferSourceStr(source))).toBe("List<String>");
    for (const interpreter of [false, true]) expect(run(source, interpreter)).toEqual(["int", "float", "float"]);
  });

  it("preserves Floats through quote, quasiquote, macro expansion, and map/reduce", () => {
    expect(Evaluator.printKValue(run("'[1 1.0]"))).toBe("[1 1.0]");
    expect(Evaluator.printKValue(run("`[~(* 2.0 3)]"))).toContain("6.0");
    expect(Evaluator.printKValue(run("(macro (six) (* 2.0 3)) (six)"))).toBe("6.0");
    expect(Evaluator.printKValue(run("(reduce (fn [a b] (+ a b)) 0 (map (fn [x] (* x 2.0)) [1 2 3]))"))).toBe("12.0");
    expect(run('(str 2 "|" 2.0)')).toBe("2|2.");
  });

  it("round-trips the literal distinction through source and structural codecs", () => {
    const source = "[1 1.0 1e0 -0.0]";
    const expectKinds = (text: string) => {
      const vector = forms(text)[0]!;
      expect(vector._tag).toBe("Vector");
      if (vector._tag === "Vector") expect(vector.items.map(item => item._tag === "Num" && item.numericKind)).toEqual(["int", "float", "float", "float"]);
    };
    expectKinds(Effect.runSync(Formatter.formatLispSource(source)));
    expectKinds(Syntax.outlineToSource(Syntax.sourceToOutline(source).items).source);
    const identity = Syntax.identifySyntax("[1 1.0 1e0 -0.0]");
    const target = identity.nodes.find(node => node.span.start === 1 && node.span.end === 2)!;
    const edited = Editor.applyEditScript({ source, identity, script: {version: 1, ops: [{op: "replace", target: target.id, text: "2"}]} });
    expect(edited.ok).toBe(true);
    if (edited.ok) expectKinds(edited.source);
  });

  it("keeps overflowing Float literals readable after formatting", () => {
    const formatted = Effect.runSync(Formatter.formatLispSource("[1e400 -1e400]"));
    const vector = forms(formatted)[0]!;
    expect(vector).toMatchObject({ _tag: "Vector", items: [
      {_tag: "Num", numericKind: "float", value: Infinity},
      {_tag: "Num", numericKind: "float", value: -Infinity},
    ]});
    expect(forms("-0")[0]).toMatchObject({numericKind: "int", value: 0});
  });

  it("keeps fractional externally supplied S-expressions compatible", () => {
    const parsed = forms("1.5")[0]!;
    if (parsed._tag !== "Num") throw new Error("expected numeric literal");
    const {numericKind: _kind, ...legacy} = parsed;
    expect(lower(legacy)).toMatchObject({lit: {_tag: "LFloat", value: 1.5}});
    expect(Evaluator.printKValue(Effect.runSync(Evaluator.evaluateExprs([legacy], {builtins, stepLimit: 100_000})).value)).toBe("1.5");
  });

  it("accepts Number/Num as Float aliases and keeps Float annotations", async () => {
    for (const alias of ["Number", "Num", "Float"]) {
      expect(await Effect.runPromise(Type.inferSourceStr(`(: x ${alias}) (define x 2) x`))).toBe("Float");
      expect(await Effect.runPromise(Type.inferSourceStr(`(: x ${alias}) (define x 2.0) x`))).toBe("Float");
    }
    await expect(Effect.runPromise(Type.inferSourceStr("(: x Int) (define x 2.0) x"))).rejects.toThrow();
  });

  it("rejects Int overflow and invalid modulo in both execution paths", () => {
    expect(Reader.parse("9007199254740992").errors).not.toHaveLength(0);
    for (const interpreter of [false, true]) for (const source of ["(+ 9007199254740991 1)", "(* 9007199254740991 2)", "(mod 2.0 1)", "(mod 1 0)", "(floor 1e100)", "(floor (/ 1 0))"]) {
      expect(() => run(source, interpreter), source).toThrow();
    }
  });

  it("uses IEEE division, signed zero, and NaN equality", () => {
    for (const interpreter of [false, true]) {
      expect(run("(/ -1 0)", interpreter)).toEqual(new Evaluator.KFloat(-Infinity));
      expect(run("(/ 0 0)", interpreter)).toEqual(new Evaluator.KFloat(NaN));
      expect(run("(= (/ 0 0) (/ 0 0))", interpreter)).toBe(false);
      expect(run("(define xs [(/ 0 0)]) (= xs xs)", interpreter)).toBe(false);
      expect(Evaluator.printKValue(run("-0.0", interpreter))).toBe("-0.0");
    }
  });

  it("emits distinct schemas and checks generated Int results", () => {
    const result = Mechanics.generateEffectProgram("(type Count Int) (type Ratio Float) (: increment (-> Int Int)) (define increment [x] (+ x 1)) (: divide (-> Int Float)) (define divide [x] (/ x 2))");
    expect(result.diagnostics).toEqual([]);
    expect(result.code).toContain("Schema.Int");
    expect(result.code).toContain("Schema.Number");
    expect(result.code).toContain("__formaInt(x + 1)");
    expect(result.code).toContain("x / 2");
  });
  it("preserves integral and fractional Float literals in the mechanics runtime", async () => {
    for (const literal of ["2.0", "2.5"]) {
      const elaborated = Mechanics.elaborateEffectProgram(`(: answer (Effect Float)) (define answer (succeed ${literal}))`);
      expect(elaborated.diagnostics).toEqual([]);
      const runtime = Mechanics.makeMechanicsRuntime({declarations: elaborated.declarations, services: {}});
      expect(await runtime.invoke("answer")).toEqual(new Evaluator.KFloat(Number(literal)));
    }
  });

  it("executes generated arithmetic with checked Int overflow and native Float results", () => {
    const source = "(: increment (-> Int Int)) (define increment [x] (+ x 1)) (: divide (-> Int Float)) (define divide [x] (/ x 2)) (: rounded (-> Float Int)) (define rounded [x] (round x)) (: modulo (-> Int Int Int)) (define modulo [x y] (mod x y))";
    const result = Mechanics.generateEffectProgram(source);
    expect(result.diagnostics).toEqual([]);
    const js = ts.transpileModule(result.code!, {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022}}).outputText;
    const generated: Record<string, (...args: number[]) => number> = {};
    new Function("require", "exports", js)(createRequire(import.meta.url), generated);
    expect(generated.increment!(2)).toBe(3);
    expect(() => generated.increment!(Number.MAX_SAFE_INTEGER)).toThrow(/safe integer/);
    expect(generated.divide!(4)).toBe(2);
    expect(generated.rounded!(-1.5)).toBe(-1);
    expect(() => generated.rounded!(Infinity)).toThrow(/safe integer/);
    expect(() => generated.modulo!(1, 0)).toThrow(/nonzero/);
  });

});
