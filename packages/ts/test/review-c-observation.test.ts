/**
 * Review C: observation provenance.
 *
 * Provenance lives in identity-keyed WeakMaps (source traces and origins), and
 * expanded trees share node objects with the author's parse and with macro
 * templates. These tests pin the behavior that is right and record, as
 * `test.fails`, the sibling bugs of that root cause.
 */
import fc from "fast-check";
import { describe, expect, test } from "vitest";

import { Engine, Evaluator, Syntax } from "../src/index.js";
import { parse, toSExprMany } from "../src/reader/index.js";
import { requiresEvaluatorRuntime } from "../src/evaluator/vm-bridge.js";
import { runs } from "./support/runs.js";

/** A top-level form that never runs its unquote but forces the evaluator fallback. */
const FALLBACK = "\n(if false ~unused 0)";

const observe = async (source: string, stepLimit?: number) => {
  const result = await Engine.evaluate({
    source,
    observe: {},
    ...(stepLimit !== undefined ? { stepLimit } : {}),
  });
  const records = result.observations!.records;
  const at = (text: string, nth = 0) =>
    records.filter((record) => source.slice(record.span.start, record.span.end) === text)[nth];
  const startOf = (text: string, nth = 0) => {
    let index = -1;
    for (let i = 0; i <= nth; i++) index = source.indexOf(text, index + 1);
    return index;
  };
  return { result, records, at, startOf };
};

const printed = (record: Engine.ExpressionObservation | undefined) =>
  record && record.count > 0 ? Evaluator.printKValue(record.value) : undefined;

const expand = (source: string) =>
  Evaluator.expandKernelExprsSync(toSExprMany(parse(source).redTree), {}).expanded;

/** Every record names a node of the author's parse, outside any macro definition. */
const expectAuthorRecords = (source: string, records: readonly Engine.ExpressionObservation[]) => {
  const identity = Syntax.identifySyntax(source);
  const spans = new Set(identity.nodes.map((node) => `${node.span.start}:${node.span.end}`));
  const definitions = identity.nodes.filter(
    (node) => node.kind === "List" && source.startsWith("(define-macro", node.span.start),
  );
  for (const record of records) {
    expect(spans.has(`${record.span.start}:${record.span.end}`)).toBe(true);
    expect(
      definitions.some((def) => def.span.start <= record.span.start && record.span.end <= def.span.end),
    ).toBe(false);
  }
};

describe("expansion provenance (pinned)", () => {
  test("the fallback marker really forces the evaluator, and quasiquote alone does not", () => {
    expect(requiresEvaluatorRuntime(expand("(if false ~x 0)"))).toBe(true);
    // The existing "evaluator fallback" test in observation.test.ts runs on the VM.
    expect(requiresEvaluatorRuntime(expand("(let [x 1] `(a ~(+ x 1)))"))).toBe(false);
  });

  test.each(["", FALLBACK])("a macro returning a shared template node keeps its calls apart%s", async (suffix) => {
    // Bug 10 repro, extended through a second macro and onto the fallback.
    const source = "(define-macro k [] `y)\n(define-macro kk [] `(k))\n(let [y 1] (kk))\n(let [y 2] (kk))" + suffix;
    const { result, records, at } = await observe(source);
    expect(result.diagnostics).toEqual([]);
    expect(at("(kk)", 0)).toMatchObject({ count: 1 });
    expect(printed(at("(kk)", 0))).toBe("1");
    expect(printed(at("(kk)", 1))).toBe("2");
    expectAuthorRecords(source, records);
  });

  test.each(["", FALLBACK])("shared non-root template nodes never get records%s", async (suffix) => {
    const source = "(define-macro m [x] `(do ~x (+ 1 1)))\n(m 10)\n(m 20)" + suffix;
    const { result, records, at } = await observe(source);
    expect(result.diagnostics).toEqual([]);
    expect(printed(at("(m 10)"))).toBe("2");
    expect(printed(at("(m 20)"))).toBe("2");
    expect(at("10")).toMatchObject({ count: 1 });
    expect(at("20")).toMatchObject({ count: 1 });
    expectAuthorRecords(source, records);
  });

  test.each(["", FALLBACK])("duplicated and nested arguments count every evaluation%s", async (suffix) => {
    const source = "(define-macro tw [x] `(do ~x ~x))\n(tw (tw (+ 1 2)))" + suffix;
    const { at } = await observe(source);
    expect(at("(tw (tw (+ 1 2)))")).toMatchObject({ count: 1 });
    expect(at("(tw (+ 1 2))")).toMatchObject({ count: 2 });
    expect(at("(+ 1 2)")).toMatchObject({ count: 4 });
  });

  test("a macro that returns its argument as the expansion records both call and argument", async () => {
    for (const source of ["(cond :else (+ 1 2))", "(and (+ 1 2))", "(and (when true (+ 1 2)))"]) {
      const { at } = await observe(source);
      expect(printed(at(source))).toBe("3");
      expect(printed(at("(+ 1 2)"))).toBe("3");
      expect(at("(+ 1 2)")).toMatchObject({ count: 1 });
    }
  });

  test("prelude macros: nested, threaded, multi-clause", async () => {
    const nested = await observe("(when (not false) (+ 1 2))");
    expect(printed(nested.at("(when (not false) (+ 1 2))"))).toBe("3");
    expect(printed(nested.at("(not false)"))).toBe("true");
    expect(printed(nested.at("(+ 1 2)"))).toBe("3");

    const source = "(-> 1 (+ 2) (* 3))";
    const threaded = await observe(source);
    expect(printed(threaded.at(source))).toBe("9");
    // `(+ 2)` and `(* 3)` never run as written: only the threaded forms do.
    expect(threaded.at("(+ 2)")).toBeUndefined();
    expect(threaded.at("(* 3)")).toBeUndefined();
    expect(printed(threaded.at("3"))).toBe("3");

    const cond = await observe("(cond (> 1 2) :a (< 1 2) :b :else :c)");
    expect(printed(cond.at("(cond (> 1 2) :a (< 1 2) :b :else :c)"))).toBe(":b");
    expect(printed(cond.at("(< 1 2)"))).toBe("true");
    expect(cond.at(":a")).toBeUndefined();
    expect(cond.at(":c")).toBeUndefined();
  });

  test("binders, patterns, signatures and quoted data get no records", async () => {
    const source =
      "(define (f x) x)\n(let [[a b] [1 2]] (+ a b))\n((fn [y] y) 3)\n(match 4 z (+ z 1))\n" +
      "(define-macro qq [x] `(quasiquote ~x))\n(qq (+ 5 6))\n`(c (+ 7 8))";
    const { result, records, at, startOf } = await observe(source);
    expect(result.diagnostics).toEqual([]);
    for (const text of ["(f x)", "[a b]", "a", "[y]", "z", "(+ 5 6)", "(c (+ 7 8))", "(+ 7 8)"]) {
      // The first occurrence of each text is the binder, pattern or datum.
      expect(records.find((record) => record.span.start === startOf(text))).toBeUndefined();
    }
    expect(printed(at("(+ a b)"))).toBe("3");
    expect(printed(at("[1 2]"))).toBe("[1 2]");
    expect(printed(at("(qq (+ 5 6))"))).toBe("(+ 5 6)");
  });

  test("records are keyed by the caller's identity through macro expansions", async () => {
    const source = "(define-macro tw [x] `(do ~x ~x))\n(tw (when true (+ 1 2)))";
    const identity = Syntax.identifySyntax(source, { idPrefix: "row-" });
    const result = await Engine.evaluate({ source, observe: { identity } });
    const bySpan = new Map(identity.nodes.map((node) => [`${node.span.start}:${node.span.end}`, node.id]));
    expect(result.observations!.records.length).toBeGreaterThan(0);
    for (const record of result.observations!.records) {
      expect(record.nodeId).toBe(bySpan.get(`${record.span.start}:${record.span.end}`));
    }
  });

  test("repeated evaluations of the same source give identical records", async () => {
    const source = "(define-macro m [x] `(do ~x (+ 1 1)))\n(m (not (= 1 2)))\n(cond false 1 :else (m 3))";
    const first = (await observe(source)).records;
    const second = (await observe(source)).records;
    expect(second).toEqual(first);
  });

  test("the VM observes self tail calls", async () => {
    const source = "(define (loop n) (if (= n 0) 0 (loop (- n 1))))\n(loop 3)";
    const { at } = await observe(source);
    expect(at("(if (= n 0) 0 (loop (- n 1)))")).toMatchObject({ count: 4 });
    expect(at("(loop (- n 1))")).toMatchObject({ count: 3 });
  });

  test("a failure outside any macro is attributed on both engines", async () => {
    for (const suffix of ["", FALLBACK]) {
      const { at } = await observe('(define (f) (+ 1 "x"))\n(f)' + suffix);
      expect(at('(+ 1 "x")')?.failure).toBeDefined();
    }
  });

  test("a step-limit failure has a span and is attributed", async () => {
    const { result, records } = await observe("(define (g n) (+ 1 (g n)))\n(g 1)", 2_000);
    expect(result.diagnostics[0]?.span).toBeDefined();
    expect(records.some((record) => record.failure !== undefined)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Observation must not change what a program computes.
// ---------------------------------------------------------------------------

const programArb = (() => {
  const leaf = fc.oneof(
    fc.integer({ min: -3, max: 9 }).map(String),
    fc.constantFrom('"s"', "true", "false", "nil", ":k", "v"),
  );
  const { expr } = fc.letrec<{ expr: string }>((tie) => ({
    expr: fc.oneof(
      { depthSize: "small", withCrossShrink: true },
      leaf,
      fc.tuple(fc.constantFrom("+", "-", "*", "=", "<"), tie("expr"), tie("expr")).map(([op, a, b]) => `(${op} ${a} ${b})`),
      fc.tuple(tie("expr"), tie("expr"), tie("expr")).map(([a, b, c]) => `(if ${a} ${b} ${c})`),
      fc.tuple(tie("expr"), tie("expr")).map(([a, b]) => `(let [v ${a}] ${b})`),
      fc.tuple(tie("expr"), tie("expr")).map(([a, b]) => `(when ${a} ${b})`),
      fc.tuple(tie("expr"), tie("expr"), tie("expr")).map(([a, b, c]) => `(cond ${a} ${b} :else ${c})`),
      fc.tuple(fc.constantFrom("and", "or"), tie("expr"), tie("expr")).map(([op, a, b]) => `(${op} ${a} ${b})`),
      tie("expr").map((a) => `(not ${a})`),
      fc.tuple(tie("expr"), tie("expr")).map(([a, b]) => `(-> ${a} (+ ${b}))`),
      fc.tuple(tie("expr"), tie("expr")).map(([a, b]) => `[${a} ${b}]`),
      fc.tuple(tie("expr"), tie("expr")).map(([a, b]) => `(do ${a} ${b})`),
      fc.tuple(tie("expr"), tie("expr")).map(([a, b]) => `((fn [v] ${a}) ${b})`),
      tie("expr").map((a) => `(tw ${a})`),
      tie("expr").map((a) => `(sh ${a})`),
      tie("expr").map((a) => `(f ${a})`),
      tie("expr").map((a) => `\`(q ~${a})`),
    ),
  }));
  const prelude =
    "(define-macro tw [x] `(do ~x ~x))\n(define-macro sh [x] `(do ~x (+ 1 1)))\n(define v 1)\n";
  return fc
    .tuple(expr, expr, expr, fc.boolean())
    .map(
      ([body, a, b, fallback]) =>
        `${prelude}(define (f v) ${body})\n${a}\n${b}${fallback ? FALLBACK : ""}`,
    );
})();

// Observed calls leave tail position. That renames the VM's "Cannot
// tail-call" failure (pinned separately below) and, as documented, adds return
// steps, so a step-limit failure may stop at a different expression.
const summary = (result: Engine.EvaluateResult) => ({
  printed: result.printed,
  diagnostics: result.diagnostics.map((d) => ({
    code: d.code,
    message: d.message.replace("Cannot tail-call", "Cannot call"),
    span: d.code === "StepLimitExceeded" ? undefined : d.span,
  })),
});

test("observation never changes the printed result or diagnostics", async () => {
  await fc.assert(
    fc.asyncProperty(programArb, async (source) => {
      const plain = await Engine.evaluate({ source, stepLimit: 5_000 });
      const observed = await Engine.evaluate({ source, stepLimit: 5_000, observe: {} });
      expect(summary(observed)).toEqual(summary(plain));
      expectAuthorRecords(source, observed.observations!.records);
    }),
    { numRuns: runs(200) },
  );
}, 60_000);

// ---------------------------------------------------------------------------
// Confirmed sibling bugs.
// ---------------------------------------------------------------------------

describe("sibling bugs (expected behavior, currently failing)", () => {
  // Root cause: tagExpandedExpr overwrites the source trace of author argument
  // nodes passed through a macro with the call's loc, so the argument's failure
  // locates at (and is attributed to) the whole call.
  test.fails("a failure inside a macro argument is attributed to the argument", async () => {
    const { result, at, startOf } = await observe('(when true (+ 1 "x"))');
    expect(result.diagnostics[0]?.span?.startOffset).toBe(startOf('(+ 1 "x")'));
    expect(at('(+ 1 "x")')?.failure).toBeDefined();
    expect(at('(when true (+ 1 "x"))')?.failure).toBeUndefined();
  });

  // Root cause: expandExpr tags a nested expansion with `expr.loc` of the inner
  // macro call, which is a prelude template node, so author arguments inherit
  // offsets into the prelude source.
  test.fails("a failure inside an argument of a recursive prelude macro stays in the source", async () => {
    const source = '(cond false 1 (+ 1 "x") 2)';
    const { result, records } = await observe(source);
    const span = result.diagnostics[0]!.span!;
    expect(span.endOffset).toBeLessThanOrEqual(source.length); // actually 532..553
    expect(records.some((record) => record.failure !== undefined)).toBe(true); // actually none
  });

  // Root cause: quasiquote reuses template atoms in every expansion and
  // tagExpandedExpr overwrites their trace, so all calls share the last call's loc.
  test.fails("a failure in a template atom is attributed to the call that ran it", async () => {
    const source = "(define-macro m [x] `(do ~x (undefined-fn 1)))\n(m 1)\n(m 2)";
    const { result, at, startOf } = await observe(source);
    expect(result.diagnostics[0]?.span?.startOffset).toBe(startOf("(m 1)")); // actually (m 2)
    expect(at("(m 1)")?.failure).toBeDefined();
    expect(at("(m 2)")).toBeUndefined();
  });

  // Root cause: the prelude's template atoms are cached for the process and
  // tagExpandedExpr prepends an origin to their trace on every expansion.
  test.fails("a template atom's trace carries only the current expansion's origin", () => {
    const lengths = [0, 1, 2].map(() => {
      const ifForm = expand("(not 1)")[0]!;
      if (ifForm._tag !== "List") throw new Error("expected (if 1 false true)");
      return Evaluator.sourceTraceOf(ifForm.items[2]!).macroOrigins?.length;
    });
    expect(lengths).toEqual([1, 1, 1]); // actually grows by one per expansion, ever
  });

  // Root cause: withKernelSourceTrace lets every enclosing frame whose trace has
  // macroOrigins replace the loc, and argument traces were tagged with the call,
  // so on the evaluator the outermost macro call wins over the real site.
  test.fails("the fallback attributes a failure in a function called from a macro argument to its site", async () => {
    const { at } = await observe('(define (f) (+ 1 "x"))\n(when true (f))' + FALLBACK);
    expect(at('(+ 1 "x")')?.failure).toBeDefined(); // the VM does; the fallback blames (when true (f))
  });

  // Root cause: evalExpr skips observe for KTailCall sentinels, and the
  // trampoline in applyKFn never reports the value back to the call or its `if`.
  test.fails("the fallback observes self tail calls like the VM", async () => {
    const source = "(define (loop n) (if (= n 0) 0 (loop (- n 1))))\n(loop 3)" + FALLBACK;
    const { at } = await observe(source);
    expect(at("(if (= n 0) 0 (loop (- n 1)))")).toMatchObject({ count: 4 }); // actually 1
    expect(at("(loop (- n 1))")).toMatchObject({ count: 3 }); // actually no record
  });

  // Root cause: expand.ts evaluateMacro raises ArityError without a loc, and
  // ObservationCollector.fail drops failures that have no location.
  test.fails("a macro arity failure is attributed to the call", async () => {
    const { result, at } = await observe("(define a 1)\n(not 1 2)");
    expect(result.diagnostics[0]?.span).toBeDefined();
    expect(at("(not 1 2)")?.failure).toBeDefined();
  });

  // Root cause: OBSERVE compiles an observed call out of tail position, and the
  // VM names the failing opcode, so observation changes the diagnostic text.
  test.fails("observation does not change a failure's message", async () => {
    const source = "(define (f) (1 2))\n(f)";
    const plain = await Engine.evaluate({ source });
    const observed = await Engine.evaluate({ source, observe: {} });
    expect(observed.diagnostics[0]?.message).toBe(plain.diagnostics[0]?.message); // "Cannot call" vs "Cannot tail-call"
  });

  // Root cause (reader, not provenance): a reader-macro list's loc covers only
  // the prefix token, so the collector's span lookup never matches it.
  test.fails("a quasiquote expression records its value", async () => {
    const { at } = await observe("(define x 5)\n`[a ~x]");
    expect(printed(at("`[a ~x]"))).toBe("[a 5]");
  });
});
