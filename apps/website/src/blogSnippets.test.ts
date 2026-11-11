import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Cause, Effect, Exit, Schema } from "effect";
import { describe, expect, expectTypeOf, test } from "vitest";
import { evaluate, read, show } from "../../../docs/snippets/blog/in-the-beginning/01/lisp.ts";
import { expand, operators, sumTo } from "../../../docs/snippets/blog/in-the-beginning/01/programs.ts";
import { run } from "../../../docs/snippets/blog/in-the-beginning/01/schema.ts";
import { display, evaluate as evaluate2 } from "../../../docs/snippets/blog/in-the-beginning/02/evaluate.ts";
import { ExprFromSexp, parse } from "../../../docs/snippets/blog/in-the-beginning/02/expr.ts";
import { read as read2, render } from "../../../docs/snippets/blog/in-the-beginning/02/read.ts";
import { show as show2 } from "../../../docs/snippets/blog/in-the-beginning/02/sexp.ts";
import type { Diagnostic } from "../../../docs/snippets/blog/in-the-beginning/02/read.ts";
import { display as display3, type Value } from "../../../docs/snippets/blog/in-the-beginning/03/environment.ts";
import type { NotCallable, NotANumber, UnboundName } from "../../../docs/snippets/blog/in-the-beginning/03/errors.ts";
import { buggy, lenient } from "../../../docs/snippets/blog/in-the-beginning/03/handle.ts";
import { report, run as run3 } from "../../../docs/snippets/blog/in-the-beginning/03/run.ts";
import { Output, recordedOutput } from "../../../docs/snippets/blog/in-the-beginning/04/capabilities.ts";
import { dynamic, evaluateWith } from "../../../docs/snippets/blog/in-the-beginning/04/evaluate.ts";
import { type Failure as Failure4, report as report4, run as run4 } from "../../../docs/snippets/blog/in-the-beginning/04/run.ts";
import { display as display4, type Value as Value4 } from "../../../docs/snippets/blog/in-the-beginning/04/scope.ts";
import { called } from "../../../docs/snippets/blog/in-the-beginning/04/services.ts";
import { quiet } from "../../../docs/snippets/blog/in-the-beginning/04/worlds.ts";
import { report as report5, run as run5, typeOf } from "../../../docs/snippets/blog/in-the-beginning/05/run.ts";
import { Type } from "../../../docs/snippets/blog/in-the-beginning/05/types.ts";
import { showCore } from "../../../docs/snippets/blog/in-the-beginning/06/core.ts";
import { display as display6, execute, type Value as Value6 } from "../../../docs/snippets/blog/in-the-beginning/06/execute.ts";
import {
  build,
  compile,
  type Failure as Failure6,
  load,
  report as report6,
  run as run6,
  typeOf as typeOf6,
} from "../../../docs/snippets/blog/in-the-beginning/06/run.ts";
import { report as report7, run as run7, expansion } from "../../../docs/snippets/blog/in-the-beginning/07/run.ts";
import { standard } from "../../../docs/snippets/blog/in-the-beginning/08/prelude.ts";
import { combined, pricing } from "../../../docs/snippets/blog/in-the-beginning/08/pricing.ts";
import {
  compile as compile8,
  report as report8,
  run as run8,
  typeOf as typeOf8,
} from "../../../docs/snippets/blog/in-the-beginning/08/run.ts";
import type { Prelude } from "../../../docs/snippets/blog/in-the-beginning/08/kernel.ts";
import { standard as standard9 } from "../../../docs/snippets/blog/in-the-beginning/09/prelude.ts";
import { analyze, type Finding, typeAt } from "../../../docs/snippets/blog/in-the-beginning/10/analyze.ts";
import { FormDoc, standardDocs } from "../../../docs/snippets/blog/in-the-beginning/10/describe.ts";
import { document } from "../../../docs/snippets/blog/in-the-beginning/10/document.ts";
import { format } from "../../../docs/snippets/blog/in-the-beginning/10/format.ts";
import { inspect, type Report, ReportJson } from "../../../docs/snippets/blog/in-the-beginning/10/inspect.ts";
import { readAll } from "../../../docs/snippets/blog/in-the-beginning/07/read.ts";
import { replace as replace11 } from "../../../docs/snippets/blog/in-the-beginning/11/edit.ts";
import { rename } from "../../../docs/snippets/blog/in-the-beginning/11/rename.ts";
import { call, inMemory, manifest, toolsFor, Workspace } from "../../../docs/snippets/blog/in-the-beginning/11/tools.ts";
import { Approvals, Directory, unavailable, values as values12 } from "../../../docs/snippets/blog/in-the-beginning/12/capabilities.ts";
import {
  dryRun,
  load as loadLanguage,
  runPolicy,
  typeOfPolicy,
  vendorLanguage,
  vendorSource,
} from "../../../docs/snippets/blog/in-the-beginning/12/language.ts";
import { typecheck as formaTypecheck, evaluate as formaEvaluate } from "@formalang/ts/engine";
import {
  compile as compile9,
  report as report9,
  run as run9,
  script,
  typeOf as typeOf9,
} from "../../../docs/snippets/blog/in-the-beginning/09/run.ts";

const repoRoot = resolve(import.meta.dirname, "../../..");
const lisp = (source: string) => show(evaluate(read(source)));

// The blog shows these snippets and quotes their results; keep both honest.
describe("blog: Start with a List", () => {
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

describe("blog: Giving the List a Schema", () => {
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
    const once = read2("(+ 1 2)");
    expect(Effect.runSync(once)).toEqual(Effect.runSync(once));
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

describe("blog: Errors Are Not Exceptions", () => {
  const page = readFileSync(resolve(repoRoot, "docs/blog/in-the-beginning/03-errors-are-not-exceptions.md"), "utf8");
  const value = (source: string) => display3(Effect.runSync(run3(source)));
  const failure = (source: string) => Effect.runSync(Effect.flip(run3(source)));
  const reported = (source: string) => report(source, failure(source));

  test("the page includes every snippet file", () => {
    for (const file of ["errors.ts", "environment.ts", "evaluate.ts", "run.ts", "handle.ts"]) {
      expect(page).toContain(`@/snippets/blog/in-the-beginning/03/${file}`);
    }
  });

  test("programs that work", () => {
    expect(value("(+ 1 2)")).toBe("3");
    expect(value("(/ 10 4)")).toBe("2.5");
    expect(value("(* 2 pi)")).toBe("6.283185307179586");
    expect(value("+")).toBe("#<primitive +>");
  });

  test("runtime failures are tagged data that point at the source", () => {
    expect(reported("(+ 1 (quote x))")).toBe("error: + expects numbers, got x\n1 | (+ 1 (quote x))\n  |      ^^^^^^^^^");
    expect(reported("(/ 10 (+ 2 -2))")).toBe("error: division by zero\n1 | (/ 10 (+ 2 -2))\n  |       ^^^^^^^^");
    expect(reported("(* 2 (pi 3))")).toBe("error: pi is not a function\n1 | (* 2 (pi 3))\n  |       ^^");
    expect(reported("(+ 1 y)")).toBe("error: y is not defined\n1 | (+ 1 y)\n  |      ^");
    expect(JSON.parse(JSON.stringify(failure("(+ 1 (quote x))")))).toEqual({
      _tag: "NotANumber",
      op: "+",
      got: "x",
      span: { start: 5, end: 14 },
    });
    expect(failure("(+ (/ 1 0) y)")).toMatchObject({ _tag: "DivByZero" });
  });

  test("a host recovers from one failure and the type drops it", () => {
    expect(display3(Effect.runSync(lenient("(+ 1 (/ 1 0))")))).toBe("Infinity");
    expectTypeOf(lenient).returns.toEqualTypeOf<
      Effect.Effect<Value, Diagnostic | UnboundName | NotCallable | NotANumber>
    >();
  });

  test("an interpreter bug is a defect, not an EvalError", () => {
    const exit = Effect.runSyncExit(run3("(+ 1 (oops))", buggy));
    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      expect(Cause.hasDies(exit.cause)).toBe(true);
      expect(Cause.hasFails(exit.cause)).toBe(false);
      expect(String(Cause.squash(exit.cause))).toBe("Error: index out of range");
    }
  });
});

describe("blog: The Environment Is Not the World", () => {
  const page = readFileSync(resolve(repoRoot, "docs/blog/in-the-beginning/04-environment-is-not-the-world.md"), "utf8");
  const scoping = "((lambda (x)\n   ((lambda (f)\n      ((lambda (x) (f 0)) 100))\n    (lambda (y) (+ x y))))\n 1)";
  const exec = (source: string, evaluator?: Parameters<typeof run4>[1]) => {
    const { lines, output } = recordedOutput();
    const program = run4(source, evaluator).pipe(Effect.provideService(Output, output));
    return { exit: Effect.runSyncExit(program), lines, program };
  };
  const value = (source: string, evaluator?: Parameters<typeof run4>[1]) => {
    const { exit } = exec(source, evaluator);
    if (Exit.isFailure(exit)) throw new Error(String(exit.cause));
    return display4(exit.value);
  };
  const reported = (source: string) => report4(source, Effect.runSync(Effect.flip(exec(source).program)));

  test("the page includes every snippet file", () => {
    for (const file of ["expr.ts", "errors.ts", "scope.ts", "evaluate.ts", "services.ts", "capabilities.ts", "run.ts", "worlds.ts"]) {
      expect(page).toContain(`@/snippets/blog/in-the-beginning/04/${file}`);
    }
    expect(page).toContain(scoping.replaceAll("\\n", "\n"));
  });

  test("functions and closures", () => {
    expect(value("((lambda (x) (* x x)) 7)")).toBe("49");
    expect(value("(((lambda (n) (lambda (x) (+ x n))) 10) 5)")).toBe("15");
    expect(value("((lambda (print) (+ print 1)) 41)")).toBe("42");
    expect(reported("(lambda (x x) x)")).toBe("error: x is already a parameter\n1 | (lambda (x x) x)\n  |            ^");
    expect(reported("((lambda (x) x) 1 2)")).toMatch(/^error: expected 1 argument, got 2\n/);
  });

  test("lexical and dynamic scope disagree, and services are dynamic", () => {
    expect(value(scoping)).toBe("1");
    expect(value(scoping, evaluateWith(dynamic))).toBe("100");
    expect(Effect.runSync(called)).toBe(100);
  });

  test("output is a capability the host provides", () => {
    expect(quiet()).toEqual({ result: 3, lines: ["1", "2"] });
    expectTypeOf(run4).returns.toEqualTypeOf<Effect.Effect<Value4, Failure4, Output>>();
  });

  test("a bad argument still fails only at runtime, inside the body", () => {
    expect(reported("((lambda (x) (+ x 1)) (quote a))")).toBe(
      "error: + expects numbers, got a\n1 | ((lambda (x) (+ x 1)) (quote a))\n  |                 ^",
    );
  });
});

describe("blog: Types Before Execution", () => {
  const page = readFileSync(resolve(repoRoot, "docs/blog/in-the-beginning/05-types-before-execution.md"), "utf8");
  const type = (source: string) => Effect.runSync(typeOf(source));
  const rejected = (source: string) => report5(source, Effect.runSync(Effect.flip(typeOf(source))));
  const exec = (source: string) => {
    const { lines, output } = recordedOutput();
    const program = run5(source).pipe(Effect.provideService(Output, output));
    return { exit: Effect.runSyncExit(program), lines, program };
  };

  test("the page includes every snippet file", () => {
    for (const file of ["types.ts", "check.ts", "errors.ts", "run.ts"]) {
      expect(page).toContain(`@/snippets/blog/in-the-beginning/05/${file}`);
    }
  });

  test("types are data with a schema", () => {
    const numToNum = { _tag: "TFun", params: [{ _tag: "TNum" }], rest: null, result: { _tag: "TNum" } };
    expect(Schema.decodeUnknownSync(Type)(numToNum)).toEqual(numToNum);
    const bad = { ...numToNum, params: [{ _tag: "Num" }] };
    const error = Effect.runSync(Effect.flip(Schema.decodeUnknownEffect(Type)(bad)));
    expect(error.message.endsWith('\n  at ["params"][0]')).toBe(true);
  });

  test("the checker infers the types the post lists", () => {
    expect(type("(lambda (x) (+ x 1))")).toBe("(Num) -> Num");
    expect(type("(lambda (x) x)")).toBe("('a) -> 'a");
    expect(type("(lambda (f x) (f (f x)))")).toBe("(('a) -> 'a, 'a) -> 'a");
    expect(type("(lambda (f g x) (f (g x)))")).toBe("(('a) -> 'b, ('c) -> 'a, 'c) -> 'b");
    expect(type("+")).toBe("(Num...) -> Num");
    expect(type("(print (quote hi))")).toBe("Data");
    expect(type("((lambda (f) (f 1 2)) +)")).toBe("Num");
    expect(type("(/ 1 0)")).toBe("Num");
  });

  test("ill-typed programs are rejected at the source of the mistake", () => {
    expect(rejected("((lambda (x) (+ x 1)) (quote a))")).toBe(
      "error: expected Num, got Data\n1 | ((lambda (x) (+ x 1)) (quote a))\n  |                       ^^^^^^^^^",
    );
    expect(rejected("(+ 1 (quote hello))")).toBe("error: expected Num, got Data\n1 | (+ 1 (quote hello))\n  |      ^^^^^^^^^^^^^");
    expect(rejected("(5 1)")).toBe("error: expected a function, got Num\n1 | (5 1)\n  |  ^");
    expect(rejected("(print 1 2)")).toBe("error: expected 1 argument, got 2\n1 | (print 1 2)\n  | ^^^^^^^^^^^");
    expect(rejected("(lambda (x) (x x))")).toBe("error: infinite type: 'a = ('a) -> 'b\n1 | (lambda (x) (x x))\n  |              ^");
    expect(rejected("(+ 1 y)")).toMatch(/^error: y is not defined\n/);
  });

  test("checking happens before anything runs", () => {
    const failed = exec("(+ (print 1) (quote x))");
    expect(Exit.isFailure(failed.exit)).toBe(true);
    expect(failed.lines).toEqual([]);
    const ok = exec("(+ (print 1) (print 2))");
    expect(Exit.isSuccess(ok.exit) && ok.exit.value).toBe(3);
    expect(ok.lines).toEqual(["1", "2"]);
    expect(Effect.runSync(Effect.flip(exec("(/ 1 0)").program))).toMatchObject({ _tag: "DivByZero" });
  });

  test("the checker rejects some programs that would run", () => {
    const selfApply = "((lambda (id) ((id id) 1)) (lambda (x) x))";
    const { output } = recordedOutput();
    expect(display4(Effect.runSync(run4(selfApply).pipe(Effect.provideService(Output, output))))).toBe("1");
    expect(rejected(selfApply)).toMatch(/^error: infinite type: 'a = \('a\) -> 'b\n/);
    expect(rejected("(lambda (f) (+ (f 1) (f (quote a))))")).toMatch(/^error: expected Num, got Data\n/);
  });
});

describe("blog: The Interpreter Becomes a Compiler", () => {
  const page = readFileSync(resolve(repoRoot, "docs/blog/in-the-beginning/06-interpreter-becomes-compiler.md"), "utf8");
  const core = (source: string) => showCore(Effect.runSync(compile(source)));
  const exec = <A, E>(program: Effect.Effect<A, E, Output>) => {
    const { lines, output } = recordedOutput();
    return { exit: Effect.runSyncExit(program.pipe(Effect.provideService(Output, output))), lines };
  };
  const value = (source: string) => {
    const { exit } = exec(run6(source));
    if (Exit.isFailure(exit)) throw new Error(String(exit.cause));
    return display6(exit.value);
  };

  test("the page includes every snippet file and the printed core", () => {
    for (const file of ["core.ts", "elaborate.ts", "execute.ts", "run.ts"]) {
      expect(page).toContain(`@/snippets/blog/in-the-beginning/06/${file}`);
    }
    for (const source of ["((lambda (x) (+ x 1)) 41)", "(print (quote hi))", "(lambda (f x) (f (f x)))"]) {
      expect(page).toContain(core(source));
    }
    expect(core("((lambda (x) ((lambda (y) x) 2)) 1)")).toContain("local x @1.0 : Num");
  });

  test("elaboration gives exactly Part 5's types and errors", () => {
    const programs = [
      "1", "+", "print", "(lambda (x) (+ x 1))", "(lambda (x) x)", "(lambda (f x) (f (f x)))",
      "(lambda (f g x) (f (g x)))", "((lambda (f) (f 1 2)) +)", "(print (quote hi))", "(+ 1 (quote hello))",
      "((lambda (x) (+ x 1)) (quote a))", "(5 1)", "(print 1 2)", "(lambda (x) (x x))", "(+ 1 y)",
      "((lambda (id) ((id id) 1)) (lambda (x) x))", "(lambda (f) (+ (f 1) (f (quote a))))",
    ];
    for (const source of programs) {
      expect(Effect.runSyncExit(typeOf6(source))).toEqual(Effect.runSyncExit(typeOf(source)));
    }
  });

  test("core runs with resolved names and only DivByZero left", () => {
    const scoping = "((lambda (x)\n   ((lambda (f)\n      ((lambda (x) (f 0)) 100))\n    (lambda (y) (+ x y))))\n 1)";
    expect(value(scoping)).toBe("1");
    expect(value("(((lambda (n) (lambda (x) (+ x n))) 10) 5)")).toBe("15");
    expect(value("((lambda (x) ((lambda (x) x) 2)) 1)")).toBe("2");
    expect(value("((lambda (x) ((lambda (y) x) 2)) 1)")).toBe("1");
    const printed = exec(run6("(+ (print 1) (print 2))"));
    expect(printed.lines).toEqual(["1", "2"]);
    const divided = exec(Effect.flip(run6("(/ 10 (+ 2 -2))")));
    expect(Exit.isSuccess(divided.exit) && report6("(/ 10 (+ 2 -2))", divided.exit.value)).toBe(
      "error: division by zero\n1 | (/ 10 (+ 2 -2))\n  |       ^^^^^^^^",
    );
    expectTypeOf(run6).returns.toEqualTypeOf<Effect.Effect<Value6, Failure6, Output>>();
  });

  test("compiled core is an artifact that runs later, and tampering is a defect", () => {
    const json = Effect.runSync(build("(+ (print 1) (print 2))"));
    const loaded = exec(load(json).pipe(Effect.flatMap((c) => execute(c, undefined))));
    expect(Exit.isSuccess(loaded.exit) && loaded.exit.value).toBe(3);
    expect(loaded.lines).toEqual(["1", "2"]);

    const tampered = Effect.runSync(build("(+ 1 2)")).replace('"name":"+"', '"name":"pi"');
    const { exit } = exec(load(tampered).pipe(Effect.flatMap((c) => execute(c, undefined))));
    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      expect(Cause.hasDies(exit.cause)).toBe(true);
      expect(Cause.hasFails(exit.cause)).toBe(false);
      expect(String(Cause.squash(exit.cause))).toBe("Error: ill-typed core: 3.141592653589793 is not a function");
    }

    const junk = Effect.runSync(Effect.flip(load('{"_tag":"Lit","value":"1"}')));
    expect(junk.message).toContain('at ["value"]');
  });
});

describe("blog: Macros Are Programs About Programs", () => {
  const page = readFileSync(resolve(repoRoot, "docs/blog/in-the-beginning/07-macros.md"), "utf8");
  const square = "(defmacro square\n  ((e) `((lambda (x) (* x x)) ,e)))";
  const letStar =
    "(defmacro let*\n  ((() body) body)\n  ((((name value) &rest more) body)\n   `((lambda (,name) (let* ,more ,body)) ,value)))";
  const thread = "(defmacro ->\n  ((x) x)\n  ((x (f &rest args) &rest steps)\n   `(-> (,f ,x ,@args) ,@steps)))";
  const scale = "(defmacro scale\n  ((k body) `((lambda (factor) (* factor ,body)) ,k)))";
  const twice = "(defmacro twice\n  ((f x) `(,f (,f ,x))))";
  const loop = "(defmacro loop\n  ((x) `(loop ,x)))";
  const program = (macro: string, body: string) => `${macro}\n\n${body}`;
  const expand = (source: string, hygienic = true) => Effect.runSync(expansion(source, hygienic));
  const exec = (source: string, hygienic = true) => {
    const { lines, output } = recordedOutput();
    const effect = run7(source, hygienic).pipe(Effect.provideService(Output, output));
    return { exit: Effect.runSyncExit(effect), effect, lines };
  };
  const value = (source: string, hygienic = true) => {
    const { exit } = exec(source, hygienic);
    if (Exit.isFailure(exit)) throw new Error(String(exit.cause));
    return display6(exit.value);
  };
  const rejected = (source: string) => report7(source, Effect.runSync(Effect.flip(exec(source).effect)));

  test("the page includes every snippet file and macro", () => {
    for (const file of ["read.ts", "macro.ts", "expand.ts", "run.ts"]) {
      expect(page).toContain(`@/snippets/blog/in-the-beginning/07/${file}`);
    }
    for (const macro of [square, letStar, thread, scale, twice]) expect(page).toContain(macro);
  });

  test("square runs its argument once and checks its call", () => {
    const once = exec(program(square, "(square (print 3))"));
    expect(Exit.isSuccess(once.exit) && once.exit.value).toBe(9);
    expect(once.lines).toEqual(["3"]);
    expect(value(program(square, "(+ 1 (square (+ 2 3)))"))).toBe("26");
    expect(rejected(program(square, "(square 1 2)"))).toBe(
      "error: no pattern of square matches this call\n4 | (square 1 2)\n  | ^^^^^^^^^^^^",
    );
    expect(rejected(program(square, "(square (quote a))"))).toBe(
      "error: expected Num, got Data\n4 | (square (quote a))\n  |         ^^^^^^^^^",
    );
    expect(value(program(square, "'(square x)"))).toBe("(square x)");
  });

  test("recursive macros expand at compile time", () => {
    const lets = program(letStar, "(let* ((x 2) (y (* x 10))) (+ x y))");
    expect(expand(lets)).toBe("((lambda (x) ((lambda (y) (+ x y)) (* x 10))) 2)");
    expect(value(lets)).toBe("22");
    const threaded = program(thread, "(-> 5 (+ 1) (* 2))");
    expect(expand(threaded)).toBe("(* (+ 5 1) 2)");
    expect(value(threaded)).toBe("12");
    expect(rejected(program(loop, "(loop 1)"))).toBe("error: loop expands forever\n2 |   ((x) `(loop ,x)))\n  |         ^^^^^^^^^");
  });

  test("hygiene keeps the macro's binders from capturing the user's names", () => {
    expect(value(program(scale, "(scale 2 3)"))).toBe("6");
    const captured = program(scale, "((lambda (factor) (scale 2 factor)) 5)");
    expect(expand(captured, false)).toBe("((lambda (factor) ((lambda (factor) (* factor factor)) 2)) 5)");
    expect(value(captured, false)).toBe("4");
    expect(expand(captured)).toBe("((lambda (factor) ((lambda (factor#1) (* factor#1 factor)) 2)) 5)");
    expect(value(captured)).toBe("10");
  });

  test("the half of hygiene the post leaves out", () => {
    const shadowed = program(scale, "((lambda (*) (scale 2 3)) +)");
    expect(expand(shadowed)).toBe("((lambda (*) ((lambda (factor#1) (* factor#1 3)) 2)) +)");
    expect(value(shadowed)).toBe("5");
    expect(expand(program(square, "((lambda (square) (square 4)) 1)"))).toContain("(lambda (x#1)");
  });

  test("an ill-typed expansion is reported inside the macro", () => {
    expect(value(program(twice, "(twice (lambda (n) (* n 3)) 1)"))).toBe("9");
    const bad = program(twice, "(twice (lambda (a b) a) 1)");
    expect(expand(bad)).toBe("((lambda (a b) a) ((lambda (a b) a) 1))");
    expect(rejected(bad)).toBe("error: expected 2 arguments, got 1\n2 |   ((f x) `(,f (,f ,x))))\n  |               ^^^^^^^");
  });

  test("the try-it program", () => {
    const source = "\n(defmacro -> ((x) x)\n  ((x (f &rest args) &rest steps) `(-> (,f ,x ,@args) ,@steps)))\n(-> 5 (+ 1) (* 2))";
    expect(expand(source)).toBe("(* (+ 5 1) 2)");
  });
});

describe("blog: The Prelude Is the Language", () => {
  const page = readFileSync(resolve(repoRoot, "docs/blog/in-the-beginning/08-prelude-is-the-language.md"), "utf8");
  const exec = (prelude: Prelude, source: string) => {
    const { lines, output } = recordedOutput();
    const effect = run8(prelude, source).pipe(Effect.provideService(Output, output));
    return { exit: Effect.runSyncExit(effect), effect, lines };
  };
  const value = (prelude: Prelude, source: string) => {
    const { exit } = exec(prelude, source);
    if (Exit.isFailure(exit)) throw new Error(String(exit.cause));
    return display6(exit.value);
  };
  const type = (prelude: Prelude, source: string) => Effect.runSync(typeOf8(prelude, source));
  const rejected = (prelude: Prelude, source: string) =>
    report8(source, Effect.runSync(Effect.flip(exec(prelude, source).effect)));
  const myLet = "(defmacro my-let\n  ((((name value)) body) `((lambda (,name) ,body) ,value)))\n\n(my-let ((id (lambda (x) x))) ((id id) 1))";
  const twice = "(let ((twice (lambda (f x) (f (f x)))))\n  twice)";
  const badTwice = "(let ((twice (lambda (f x) (f (f x)))))\n  (twice (lambda (a b) a) 1))";
  const idId = "(let ((id (lambda (x) x)))\n  ((id id) 1))";
  const size = "(let ((size (lambda (n)\n              (match n (0 'none) (1 'one) (_ 'many)))))\n  (size 1))";
  const priced = "(price 200\n  (discount 25)\n  (tax 10))";
  const sale = "(let ((sale (lambda (amount) (price amount (discount 25)))))\n  (sale 80))";

  test("the page includes every snippet file and program", () => {
    for (const file of ["kernel.ts", "prelude.ts", "pricing.ts", "run.ts"]) {
      expect(page).toContain(`@/snippets/blog/in-the-beginning/08/${file}`);
    }
    for (const program of [myLet, twice, badTwice.split("\n")[1]!, idId, size, priced, sale]) {
      expect(page).toContain(program);
    }
  });

  test("lambda and quote are prelude forms, and locals shadow forms", () => {
    expect(value(standard, "((lambda (x) (* x x)) 4)")).toBe("16");
    expect(value(standard, "'(a b)")).toBe("(a b)");
    expect(value(standard, "((lambda (if) (if 7)) (lambda (n) (* n 2)))")).toBe("14");
    expect(rejected(standard, "if")).toBe("error: if is a form, so it can only be called\n1 | if\n  | ^^");
  });

  test("let generalizes, and a let macro cannot", () => {
    expect(rejected(standard, myLet)).toBe(
      "error: infinite type: 'a = ('a) -> 'b\n4 | (my-let ((id (lambda (x) x))) ((id id) 1))\n  |                                 ^^",
    );
    expect(value(standard, idId)).toBe("1");
    expect(type(standard, "(let ((id (lambda (x) x))) id)")).toBe("('a) -> 'a");
    expect(type(standard, "(lambda (y) (let ((z y)) (+ z 1)))")).toBe("(Num) -> Num");
    expect(rejected(standard, "(lambda (y) (let ((z y)) (+ z (z 1))))")).toContain("expected Num, got (Num) -> 'a");
    expect(rejected(standard, "(lambda (f) (+ (f 1) (f 'a)))")).toContain("expected Num, got Data");    // A solved variable of this run must not be confused with a prelude scheme's own variable.
    expect(type(standard, "(let ((ap (lambda (f x) (f x))))\n  (let ((n (ap (lambda (y) y) 1)))\n    (ap (lambda (y) y) 'a)))")).toBe("Data");
  });

  test("twice is a function whose errors land at the call", () => {
    expect(type(standard, twice)).toBe("(('a) -> 'a, 'a) -> 'a");
    expect(rejected(standard, badTwice)).toBe(
      "error: expected ('a) -> 'a, got ('b, 'c) -> 'b\n2 |   (twice (lambda (a b) a) 1))\n  |          ^^^^^^^^^^^^^^^^",
    );
  });

  test("if elaborates to core with choose and thunks", () => {
    expect(showCore(Effect.runSync(compile8(standard, "(if 1 2 3)")))).toBe(
      [
        "call : Num",
        "  call : () -> Num",
        "    local choose @0.8 : (Num, () -> Num, () -> Num) -> () -> Num",
        "    lit 1 : Num",
        "    lambda () : () -> Num",
        "      lit 2 : Num",
        "    lambda () : () -> Num",
        "      lit 3 : Num",
      ].join("\n"),
    );
    const printed = exec(standard, "(if 0 (print 1) (print 2))");
    expect(Exit.isSuccess(printed.exit) && printed.exit.value).toBe(2);
    expect(printed.lines).toEqual(["2"]);
    expect(rejected(standard, "(if 1 2 'a)")).toBe("error: expected Num, got Data\n1 | (if 1 2 'a)\n  |         ^^");
    expect(rejected(standard, "(if 'a 1 2)")).toBe("error: expected Num, got Data\n1 | (if 'a 1 2)\n  |     ^^");
    expect(value(standard, "((lambda (choose) (if 1 2 3)) 5)")).toBe("2");
    expect(value(standard, "(if (< 1 2) 10 20)")).toBe("10");
  });

  test("match checks its cases", () => {
    expect(value(standard, size)).toBe("one");
    expect(value(standard, "(match 7 (0 'none) (1 'one) (_ 'many))")).toBe("many");
    expect(rejected(standard, "(match 2 (0 'none) (1 'one))")).toBe(
      "error: match needs a last (_ result) case\n1 | (match 2 (0 'none) (1 'one))\n  | ^^^^^^^^^^^^^^^^^^^^^^^^^^^^",
    );
    expect(rejected(standard, "(match 2 (0 'none) (1 2) (_ 'many))")).toBe(
      "error: expected Data, got Num\n1 | (match 2 (0 'none) (1 2) (_ 'many))\n  |                       ^",
    );
  });

  test("a pricing language on the same kernel", () => {
    expect(value(pricing, priced)).toBe("165");
    expect(type(pricing, "(price 200 (discount 25) (tax 10))")).toBe("Num");
    expect(rejected(pricing, "(price 200 (discount 120))")).toBe(
      "error: a percentage is between 0 and 100\n1 | (price 200 (discount 120))\n  |                      ^^^",
    );
    expect(rejected(pricing, "(price 200 (coupon 5))")).toBe(
      "error: expected (discount n) or (tax n)\n1 | (price 200 (coupon 5))\n  |            ^^^^^^^^^^",
    );
    expect(rejected(pricing, "(tax 8)")).toBe("error: tax only makes sense inside price\n1 | (tax 8)\n  | ^^^^^^^");
    expect(rejected(pricing, "(lambda (x) x)")).toContain("error: lambda is not defined");
    expect(rejected(pricing, "(price 'a (tax 1))")).toBe("error: quote is not defined\n1 | (price 'a (tax 1))\n  |        ^");
    expect(value(combined, sale)).toBe("60");
    expect(value(combined, "(let ((rate 10)) (price 200 (tax rate)))")).toBe("220");
  });

  test("every diagnostic on the page is the compiler's", () => {
    const cases: Array<[Prelude, string]> = [
      [standard, myLet],
      [standard, badTwice],
      [standard, "(if 1 2 'a)"],
      [standard, "(if 'a 1 2)"],
      [standard, "(match 2 (0 'none) (1 'one))"],
      [standard, "(match 2 (0 'none) (1 2) (_ 'many))"],
      [pricing, "(price 200 (discount 120))"],
      [pricing, "(price 200 (coupon 5))"],
      [pricing, "(tax 8)"],
    ];
    for (const [prelude, source] of cases) expect(page).toContain(rejected(prelude, source));
  });
});

describe("blog: Effects Are Part of the Type", () => {
  const page = readFileSync(resolve(repoRoot, "docs/blog/in-the-beginning/09-effects-are-part-of-the-type.md"), "utf8");
  const type = (source: string) => Effect.runSync(typeOf9(source));
  const twice = (body: string) => `(let ((twice (lambda (f x) (f (f x)))))\n  ${body})`;
  const rejected = (source: string, allowed: ReadonlyArray<string> | null = null) =>
    report9(source, Effect.runSync(Effect.flip(compile9(standard9, source, allowed))));
  const run = async (source: string) => {
    const { lines, output } = recordedOutput();
    const exit = await Effect.runPromiseExit(run9(standard9, source).pipe(Effect.provideService(Output, output)));
    if (Exit.isFailure(exit)) throw new Error(String(exit.cause));
    return { value: display6(exit.value), lines };
  };

  test("the page includes every snippet file", () => {
    for (const file of ["types.ts", "solver.ts", "kernel.ts", "prelude.ts", "run.ts"]) {
      expect(page).toContain(`@/snippets/blog/in-the-beginning/09/${file}`);
    }
  });

  test("built-ins say what they do", () => {
    expect(type("print")).toBe("('a) -> 'a ! {Output}");
    expect(type("/")).toBe("(Num...) -> Num ! {DivByZero}");
    expect(type("sleep")).toBe("(Num) -> Unit ! {Async}");
    expect(type("+")).toBe("(Num...) -> Num");
    expect(type("recover")).toBe("(() -> 'a ! {DivByZero | 'b}, () -> 'a ! 'b) -> 'a ! 'b");
    expect(type("fastest")).toBe("(() -> 'a ! 'b, () -> 'a ! 'b) -> 'a ! {Async | 'b}");
    for (const name of ["print", "/", "sleep", "recover", "fastest"]) expect(page).toContain(type(name));
  });

  test("calls do their effects, and functions keep them latent", () => {
    expect(type("(print 1)")).toBe("Num ! {Output}");
    expect(type("(lambda (x) (print x))")).toBe("('a) -> 'a ! {Output}");
    expect(type(twice("twice"))).toBe("(('a) -> 'a ! 'b, 'a) -> 'a ! 'b");
    expect(page).toContain(twice("twice"));
    expect(type(twice("(twice print 1)"))).toBe("Num ! {Output}");
    expect(type(twice("(twice (lambda (n) (* n 3)) 1)"))).toBe("Num");
    expect(type("(let ((id (lambda (x) x))) ((id id) 1))")).toBe("Num");    expect(type(twice("(do (twice print 1) (twice print 'a))"))).toBe("Data ! {Output}");
  });

  test("when has type Unit, and do runs in order", async () => {
    expect(type("(when (< 1 2) (print 1))")).toBe("Unit ! {Output}");
    expect(rejected("(+ 1 (when 1 2))")).toBe("error: expected Num, got Unit\n1 | (+ 1 (when 1 2))\n  |      ^^^^^^^^^^");
    expect(await run("(when 0 (print 1))")).toEqual({ value: "()", lines: [] });
    expect(await run("(when 1 (print 1))")).toEqual({ value: "()", lines: ["1"] });
    expect(await run("(do (print 1) (print 2) 3)")).toEqual({ value: "3", lines: ["1", "2"] });
  });

  test("catch takes DivByZero out of the type", async () => {
    expect(type("(catch (/ 1 0) 0)")).toBe("Num");
    expect(type("(catch (print (/ 1 0)) 0)")).toBe("Num ! {Output}");
    expect(type("(lambda (f) (catch (f 1) 0))")).toBe("((Num) -> Num ! {DivByZero | 'a}) -> Num ! 'a");
    expect(await run("(catch (/ 1 0) 0)")).toEqual({ value: "0", lines: [] });
    expect(await run("(catch (do (print 1) (/ 1 0) (print 2)) 7)")).toEqual({ value: "7", lines: ["1"] });
  });

  test("race interrupts the slower side", async () => {
    const source = "(race (do (sleep 50) (print 1))\n      (do (sleep 5) (print 2)))";
    expect(page).toContain(source);
    expect(type(source)).toBe("Num ! {Async, Output}");
    expect(await run(source)).toEqual({ value: "2", lines: ["2"] });
  });

  test("a host rejects effects it doesn't allow, before running", () => {
    expect(rejected("(print 1)", [])).toBe("error: unhandled effect: Output\n1 | (print 1)\n  | ^^^^^^^^^");
    expect(Exit.isSuccess(Effect.runSyncExit(compile9(standard9, "(lambda (x) (print x))", [])))).toBe(true);
    expect(rejected("(let ((p (lambda (x) (print x)))) (+ 1 (p 2)))", [])).toBe(
      "error: unhandled effect: Output\n1 | (let ((p (lambda (x) (print x)))) (+ 1 (p 2)))\n  |                                        ^^^^^",
    );
    const printed = recordedOutput();
    const ok = script("(do (print 1) 2)", printed.output);
    expect(Exit.isSuccess(ok) && display6(ok.value)).toBe("2");
    expect(printed.lines).toEqual(["1"]);
    const slept = recordedOutput();
    const asleep = script("(do (print 1) (sleep 10))", slept.output);
    expect(Exit.isFailure(asleep)).toBe(true);
    expect(slept.lines).toEqual([]);
    expect(rejected("(do (print 1) (sleep 10))", ["Output", "DivByZero"])).toBe(
      "error: unhandled effect: Async\n1 | (do (print 1) (sleep 10))\n  |               ^^^^^^^^^^",
    );
  });

  test("every diagnostic on the page is the compiler's", () => {
    const cases: Array<[string, ReadonlyArray<string> | null]> = [
      ["(+ 1 (when 1 2))", null],
      ["(print 1)", []],
      ["(let ((p (lambda (x) (print x)))) (+ 1 (p 2)))", []],
      ["(do (print 1) (sleep 10))", ["Output", "DivByZero"]],
    ];
    for (const [source, allowed] of cases) expect(page).toContain(rejected(source, allowed));
  });
});

describe("blog: One Program, Many Interpretations", () => {
  const page = readFileSync(resolve(repoRoot, "docs/blog/in-the-beginning/10-many-interpretations.md"), "utf8");
  const fmt = (source: string, width?: number) => Effect.runSync(format(source, standardDocs, width));
  const tree = (source: string) => Effect.runSync(readAll(source)).map(show2).join("\n");
  const checked = (source: string) => Effect.runSync(compile9(standard9, source)).core;
  const findings = (source: string) => Effect.runSync(analyze({ prelude: standard9, core: checked(source) }));
  const shown = (source: string) => findings(source).map((f) => render(source, f).replace(/^error/, f.severity));
  const crammed =
    "(let ((twice (lambda (f x)\n  (f (f x))))) (do (print\n    (twice print 1)) (when (< 1 2)\n  (print 2)) (catch (/ 1 0) 0)))";
  const hovered = "(let ((twice (lambda (f x) (f (f x)))))\n  (twice print 1))";

  test("the page includes every snippet file", () => {
    for (const file of ["describe.ts", "format.ts", "analyze.ts", "document.ts", "inspect.ts"]) {
      expect(page).toContain(`@/snippets/blog/in-the-beginning/10/${file}`);
    }
  });

  test("descriptions are decoded", () => {
    const bad = Effect.runSync(Effect.flip(Schema.decodeUnknownEffect(FormDoc)({ syntax: "x", summary: "y", head: 1.5, examples: [] })));
    expect(bad.message).toBe('Expected an integer\n  at ["head"]');
  });

  test("the formatter lays out by description and round-trips", () => {
    const formatted = fmt(crammed, 40);
    expect(formatted).toBe(
      [
        "(let ((twice (lambda (f x) (f (f x)))))",
        "  (do",
        "    (print (twice print 1))",
        "    (when (< 1 2) (print 2))",
        "    (catch (/ 1 0) 0)))",
      ].join("\n"),
    );
    expect(page).toContain(crammed);
    expect(page).toContain(formatted);
    const sources = [
      crammed,
      hovered,
      "(defmacro -> ((x) x) ((x (f &rest args) &rest steps) `(-> (,f ,x ,@args) ,@steps)))\n(-> 5 (+ 1) (* 2))",
      "(let ((size (lambda (n) (if (< n 1) 'none (if (< n 2) 'one 'many))))) (size 1))",
      "(race (do (sleep 50) (print 1)) (do (sleep 5) (print 2)))",
      "(+ 1 'a)",
    ];
    for (const width of [60, 30, 12]) {
      for (const source of sources) {
        const out = fmt(source, width);
        expect(tree(out)).toBe(tree(source));
        expect(fmt(out, width)).toBe(out);
      }
    }
    expect(fmt("(quasiquote (a (unquote b) (unquote-splicing c)))")).toBe("`(a ,b ,@c)");
  });

  test("analyzers report unused parameters and discarded pure values", () => {
    const expected: Array<[string, string[]]> = [
      ["(let ((x 1) (y 2)) (+ y 1))", ["warning: x is never used\n1 | (let ((x 1) (y 2)) (+ y 1))\n  | ^^^^^^^^^^^^^^^^^^^^^^^^^^^"]],
      [
        "(do (+ 1 2) (print 3))",
        ["warning: this value is discarded, and computing it does nothing\n1 | (do (+ 1 2) (print 3))\n  |     ^^^^^^^"],
      ],
      ["(when 1 2)", ["warning: this value is discarded, and computing it does nothing\n1 | (when 1 2)\n  |         ^"]],
      ["(do (print 1) 2)", []],
      ["(do (/ 1 2) 3)", []],
      ["(let ((f (lambda (n) (* n 2)))) (do (f 1) (print 2)))", []],
      ["(lambda (n) (do (+ n 1) (print n)))", ["warning: this value is discarded, and computing it does nothing\n1 | (lambda (n) (do (+ n 1) (print n)))\n  |                 ^^^^^^^"]],
    ];
    for (const [source, warnings] of expected) {
      expect(shown(source)).toEqual(warnings);
      for (const warning of warnings) if (!source.startsWith("(lambda")) expect(page).toContain(warning);
    }
  });

  test("hover shows the type at a position", () => {
    const core = checked(hovered);
    expect(typeAt(core, hovered.indexOf("(lambda") + 1)).toBe("(('a) -> 'a ! 'b, 'a) -> 'a ! 'b");
    expect(typeAt(core, hovered.indexOf("(twice print") + 1)).toBe("((Num) -> Num ! {Output | 'a}, Num) -> Num ! {Output | 'a}");
    expect(page).toContain(hovered);
    const plus = "(do (+ 1 2) (print 3))";
    expect(typeAt(checked(plus), plus.indexOf("+"))).toBe("(Num...) -> Num ! {Output}");
  });

  test("documentation is generated, and stale examples fail", () => {
    const reference = Effect.runSync(document(standard9, standardDocs));
    expect(reference).toContain("### `(if test yes no)`\n\nyes unless test is 0, then no. Both have one type.\n\n    (if (< 1 2) 10 20) : Num");
    expect(reference).toContain("- `print : ('a) -> 'a ! {Output}`\n\n- `sleep : (Num) -> Unit ! {Async}`");
    expect(page).toContain("- `print : ('a) -> 'a ! {Output}`\n\n- `sleep : (Num) -> Unit ! {Async}`");
    const wrong = { ...standardDocs, if: { ...standardDocs.if!, examples: [{ source: "(if 1 2 3)", type: "Data" }] } };
    expect(Effect.runSync(Effect.flip(document(standard9, wrong))).message).toBe("if: (if 1 2 3) is documented as Data, but checks as Num");
    const { when: _, ...missing } = standardDocs;
    expect(Effect.runSync(Effect.flip(document(standard9, missing))).message).toBe("when: has no description");
  });

  test("inspect combines the tools into one report", () => {
    const report = (source: string) => Effect.runSync(inspect(standard9, standardDocs, source));
    expectTypeOf(inspect).returns.toEqualTypeOf<Effect.Effect<Report>>();
    const json = Effect.runSync(Schema.encodeEffect(ReportJson)(report("(let ((x 1)) (do 0 (print 2)))")));
    expect(JSON.parse(json)).toEqual({
      formatted: "(let ((x 1)) (do 0 (print 2)))",
      type: "Num ! {Output}",
      findings: [
        { severity: "warning", message: "x is never used", span: { start: 0, end: 30 } },
        { severity: "warning", message: "this value is discarded, and computing it does nothing", span: { start: 17, end: 18 } },
      ],
    });
    expect(report("(+ 1 'a)")).toEqual({
      formatted: "(+ 1 'a)",
      type: null,
      findings: [{ severity: "error", message: "expected Num, got Data", span: { start: 5, end: 7 } }],
    });
    const unread = report("(+ 1");
    expect(unread.formatted).toBeNull();
    expect(unread.findings.map((f: Finding) => f.message)).toEqual(["this ( is never closed"]);
    expect(report("(do (+ 1 2) (print 3))").findings[0]?.message).toBe("this value is discarded, and computing it does nothing");
  });
});

describe("blog: The Agent Can Read the Language", () => {
  const page = readFileSync(resolve(repoRoot, "docs/blog/in-the-beginning/11-agent-can-read-the-language.md"), "utf8");
  const opening = "(let ((x 2) (y 5)) (+ x y))";
  const quoted = "(let ((n 2))\n  (do (print 'n) (* n n)))";
  const shadowed = "(let ((x 1)) (+ x ((lambda (x) (* x 10)) 3)))";
  const macro = "(defmacro sq ((e) `((lambda (v) (* v v)) ,e)))\n(let ((v 3)) (sq v))";
  // The offset of the nth (from 0) occurrence of `word`.
  const nth = (source: string, word: RegExp, n: number) => [...source.matchAll(word)][n]!.index;
  const renamed = (source: string, at: number, to: string) => {
    const result = Effect.runSync(Effect.result(rename(standard9, source, at, to)));
    return result._tag === "Success" ? result.success : `refused: ${result.failure.message}`;
  };
  const value = (source: string) => {
    const { output } = recordedOutput();
    return display6(Effect.runSync(run9(standard9, source).pipe(Effect.provideService(Output, output))));
  };

  test("the page includes every snippet file", () => {
    for (const file of ["meaning.ts", "rename.ts", "edit.ts", "tools.ts"]) {
      expect(page).toContain(`@/snippets/blog/in-the-beginning/11/${file}`);
    }
  });

  test("a text rename silently changes the answer", () => {
    expect(value(opening)).toBe("7");
    const text = opening.replace(/\bx\b/g, "y");
    expect(text).toBe("(let ((y 2) (y 5)) (+ y y))");
    expect(value(text)).toBe("10");
    const { lines, output } = recordedOutput();
    Effect.runSync(run9(standard9, quoted.replace(/\bn\b/g, "count")).pipe(Effect.provideService(Output, output)));
    expect(lines).toEqual(["count"]);
  });

  test("rename asks the checker", () => {
    expect(renamed(opening, 7, "z")).toBe("(let ((z 2) (y 5)) (+ z y))");
    expect(renamed(opening, nth(opening, /\bx\b/g, 1), "z")).toBe("(let ((z 2) (y 5)) (+ z y))");
    expect(renamed(opening, 7, "y")).toBe("refused: renaming x to y would change what the program means");
    expect(renamed(quoted, nth(quoted, /\bn\b/g, 2), "count")).toBe("(let ((count 2))\n  (do (print 'n) (* count count)))");
    expect(renamed(quoted, nth(quoted, /\bn\b/g, 1), "count")).toBe("refused: this n is data, not a name");
    expect(renamed(shadowed, nth(shadowed, /\bx\b/g, 1), "y")).toBe("(let ((y 1)) (+ y ((lambda (x) (* x 10)) 3)))");
    expect(renamed(shadowed, nth(shadowed, /\bx\b/g, 3), "y")).toBe("(let ((x 1)) (+ x ((lambda (y) (* y 10)) 3)))");
    expect(renamed("(lambda (x) (+ x 1))", 9, "if")).toBe("(lambda (if) (+ if 1))");
    expect(renamed("(lambda (x) (if x 1 2))", 9, "if")).toBe("refused: renaming x to if would change what the program means");
    expect(renamed("(lambda (x) (print x))", 13, "show")).toBe("refused: print belongs to the prelude");
    expect(renamed(macro, nth(macro, /\bv\b/g, 4), "w")).toBe("(defmacro sq ((e) `((lambda (v) (* v v)) ,e)))\n(let ((w 3)) (sq w))");
    expect(renamed("(lambda (x) x)", 9, "(a b)")).toBe("refused: (a b) is not a name");
    for (const program of [opening, quoted, shadowed]) expect(page).toContain(program);
  });

  test("replace keeps the file readable", () => {
    const source = "(do (print 1) (+ 1 2))";
    const replaced = (start: number, end: number, text: string) => {
      const result = Effect.runSync(Effect.result(replace11(standardDocs, source, { start, end }, text)));
      return result._tag === "Success" ? result.success : result.failure.message;
    };
    expect(replaced(14, 21, "(* 3 4)")).toBe("(do (print 1) (* 3 4))");
    expect(replaced(14, 20, "x")).toBe("no expression starts and ends there");
    expect(replaced(14, 21, "(* 3 4")).toBe("this ( is never closed");
    expect(replaced(14, 21, "1 2")).toBe("the replacement must be one expression");
  });

  test("the session on the page", () => {
    const tools = toolsFor(standard9, standardDocs);
    const session = Effect.gen(function* () {
      const answers: unknown[] = [];
      const calls: Array<[string, string]> = [
        ["read", "{}"],
        ["type_at", '{"at": 20}'],
        ["type_at", '{"at": "20"}'],
        ["rename", '{"at": 7, "to": "y"}'],
        ["rename", '{"at": 7, "to": "base"}'],
        ["evaluate", '{"expression": "(do (print 1) (/ 6 2))"}'],
        ["evaluate", '{"expression": "(sleep 10)"}'],
        ["evaluate", '{"expression": "(/ 1 0)"}'],
        ["delete", "{}"],
      ];
      for (const [name, json] of calls) answers.push(JSON.parse(yield* call(tools, name, json)));
      return answers;
    });
    const answers = Effect.runSync(session.pipe(Effect.provideServiceEffect(Workspace, inMemory(opening))));
    const error = (message: string, start = 0, end = 0) => ({ error: { message, span: { start, end } } });
    const edited = (source: string) => ({ source, report: { formatted: source, type: "Num", findings: [] } });
    expect(answers).toEqual([
      edited(opening),
      { type: "(Num...) -> Num" },
      error('Expected number\n  at ["at"]'),
      error("renaming x to y would change what the program means", 7, 8),
      edited("(let ((base 2) (y 5)) (+ base y))"),
      { value: "3", printed: ["1"] },
      error("unhandled effect: Async", 0, 10),
      error("division by zero", 5, 6),
      error("no tool named delete"),
    ]);
    const input = manifest(tools).find((t) => t.name === "rename")!.input;
    expect(input).toMatchObject({
      type: "object",
      properties: { at: { type: "integer", description: "A position in the file, counting from 0" }, to: { type: "string" } },
      required: ["at", "to"],
    });
  });
});

describe("blog: A Language for Building Languages", () => {
  const page = readFileSync(resolve(repoRoot, "docs/blog/in-the-beginning/12-let-there-be-languages.md"), "utf8");
  const forma = readFileSync(resolve(repoRoot, "docs/snippets/blog/in-the-beginning/12/vendor-types.lisp"), "utf8");
  const policy = "(do\n  (vendor acme 70 security)\n  (vendor globex 90 finance)\n  (vendor initech 50 security))";
  const rejected = (source: string) => report9(source, Effect.runSync(Effect.flip(typeOfPolicy(source))));
  const loadError = (source: string) =>
    report9(source, Effect.runSync(Effect.flip(loadLanguage({ forms: standard9.forms, values: values12(unavailable) }, standardDocs, source))));

  test("the page includes every snippet file", () => {
    for (const file of ["capabilities.ts", "defform.ts", "language.ts", "vendor.lisp", "vendor.lisp"]) {
      expect(page).toContain(`@/snippets/blog/in-the-beginning/12/${file}`);
    }
    expect(page).toContain(policy);
  });

  test("a policy's type says what it will do", () => {
    expect(Effect.runSync(typeOfPolicy(policy))).toBe("Unit ! {Approvals, Directory}");
    expect(Effect.runSync(typeOfPolicy("(vendor acme 70 security)"))).toBe("Unit ! {Approvals, Directory}");
    expect(Effect.runSync(typeOfPolicy("(review security acme)"))).toBe("Unit ! {Approvals}");
    expect(Effect.runSync(typeOfPolicy("((lambda (x) (vendor acme x security)) 70)"))).toBe("Unit ! {Approvals, Directory}");
  });

  test("the dry run requests the right approvals", async () => {
    const requested = await Effect.runPromise(dryRun(policy, new Map([["acme", 80], ["globex", 40]])));
    expect(requested).toEqual(["security reviews acme", "security reviews initech"]);
    for (const line of requested) expect(page).toContain(line);
  });

  test("errors in a call point at the call", () => {
    const shown = [
      ["(vendor acme 'high security)", "error: expected Num, got Data\n1 | (vendor acme 'high security)\n  |              ^^^^^"],
      ["(vendor acme 70)", "error: vendor takes name, limit, and owner\n1 | (vendor acme 70)\n  | ^^^^^^^^^^^^^^^^"],
      ["(vendor 'acme 70 security)", "error: vendor's name must be a name\n1 | (vendor 'acme 70 security)\n  |         ^^^^^"],
      [
        "((lambda (risk) (vendor acme 70 security)) 5)",
        "error: a local risk hides the risk vendor uses\n1 | ((lambda (risk) (vendor acme 70 security)) 5)\n  |                 ^^^^^^^^^^^^^^^^^^^^^^^^^",
      ],
    ] as const;
    for (const [source, error] of shown) {
      expect(rejected(source)).toBe(error);
      expect(page).toContain(error);
    }
    expect(rejected("((lambda (when) (vendor acme 70 security)) 5)")).toContain("a local when hides the when vendor uses");
  });

  test("errors in a template point at the declaration", () => {
    const unquoted = vendorSource.replace("(risk ',name)", "(risk ,name)");
    const misspelled = vendorSource.replace("(< ,limit", "(< ,limt");
    for (const source of [unquoted, misspelled]) {
      expect(source).not.toBe(vendorSource);
      expect(page).toContain(loadError(source));
    }
    expect(loadError(unquoted)).toBe("error: name is not defined\n7 |   `(when (< ,limit (risk ,name))\n  |                          ^^^^^");
  });

  test("a host that doesn't allow approvals rejects the policy before it runs", () => {
    const requested: string[] = [];
    const host = runPolicy(policy, ["Directory"]).pipe(
      Effect.provideService(Directory, { risk: () => Effect.succeed(100) }),
      Effect.provideService(Approvals, { request: (o, v) => Effect.sync(() => void requested.push(`${o} ${v}`)) }),
      Effect.provideService(Output, recordedOutput().output),
    );
    const error = report9(policy, Effect.runSync(Effect.flip(host)));
    expect(error).toBe("error: unhandled effect: Approvals\n2 |   (vendor acme 70 security)\n  |   ^^^^^^^^^^^^^^^^^^^^^^^^^");
    expect(page).toContain(error);
    expect(requested).toEqual([]);
  });

  test("Part 10 and 11 tools work on the new language", () => {
    const { prelude, docs } = Effect.runSync(vendorLanguage(unavailable));
    const reference = Effect.runSync(document(prelude, docs));
    expect(reference).toContain(
      "### `(review (owner Name) (vendor Name))`\n\nAsk owner to approve vendor.\n\n### `(vendor (name Name) (limit Num) (owner Name))`\n\nHave owner review name when its risk is over limit.",
    );
    expect(reference).toContain("- `risk : (Data) -> Num ! {Directory}`\n\n- `ask : (Data, Data) -> Unit ! {Approvals}`");
    const tools = toolsFor(prelude, docs);
    const answers = Effect.runSync(
      Effect.gen(function* () {
        const read = JSON.parse(yield* call(tools, "read", "{}"));
        const evaluated = JSON.parse(yield* call(tools, "evaluate", JSON.stringify({ expression: "(vendor acme 70 security)" })));
        return { type: read.report.type, error: evaluated.error.message };
      }).pipe(Effect.provideServiceEffect(Workspace, inMemory(policy))),
    );
    expect(answers).toEqual({ type: "Unit ! {Approvals, Directory}", error: "unhandled effect: Directory" });
  });

  test("the Forma version runs in Forma", async () => {
    const checked = formaTypecheck({ sourceId: "vendor.lisp", source: forma });
    expect(checked.display).toBe("Bool");
    expect(checked.diagnostics).toEqual([]);
    const evaluated = await formaEvaluate({ sourceId: "vendor.lisp", source: forma });
    expect(evaluated.value).toBe(true);
    const medium = formaTypecheck({ sourceId: "medium.lisp", source: forma.replace(":risk :high", ":risk :medium") });
    expect(medium.diagnostics.map((d) => d.message)).toEqual([expect.stringContaining(":medium is not one of Union<:low, :high>")]);
    const partial = formaTypecheck({ sourceId: "partial.lisp", source: forma.replace("\n    None false))", "))") });
    expect(partial.diagnostics.map((d) => d.message)).toEqual(["Non-exhaustive match: missing constructor(s) None"]);
  });
});
