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
