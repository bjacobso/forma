/**
 * Review D: the symbol index against the language's real scoping semantics.
 *
 * Most checks are differential: rename a definition and every reference the
 * index reports to a fresh name, evaluate before and after, and require the
 * same result. A disagreement means the index and the evaluator disagree
 * about what a name refers to.
 */
import fc from "fast-check";
import { describe, expect, test } from "vitest";

import { Editor, Engine } from "../src/index.js";
import { runs } from "./support/runs.js";

const index = (source: string) => Editor.indexSymbols([{ sourceId: "doc", source }]);

/** Offset of the `nth` occurrence of `text` as a whole symbol. */
const at = (source: string, text: string, nth = 0): number => {
  let from = 0;
  for (let count = 0; ; ) {
    const found = source.indexOf(text, from);
    if (found < 0) throw new Error(`no ${text} #${nth}`);
    const before = source[found - 1] ?? " ";
    const after = source[found + text.length] ?? " ";
    if (/[\s()[\]{}~`@]/.test(before) && /[\s()[\]{}]/.test(after)) {
      if (count === nth) return found;
      count++;
    }
    from = found + 1;
  }
};

const run = async (source: string): Promise<string> => {
  const result = await Engine.evaluate({ source, stepLimit: 20_000 });
  return result.diagnostics.length > 0 ? "error" : String(result.printed);
};

const FRESH = "fresh_q";

/** Rename the definition at `offset` and every reference the index reports for it. */
const renameAt = (source: string, offset: number): string => {
  const symbols = index(source);
  const found = Editor.findReferences(symbols, { sourceId: "doc", offset });
  if (!found.definition) throw new Error(`no definition at ${offset}`);
  const spans = [...(found.definitionSites ?? [found.definition]).map((site) => site.span), ...found.references.map((reference) => reference.span)]
    .filter((span, position, all) => all.findIndex((other) => other.start === span.start) === position)
    .sort((left, right) => right.start - left.start);
  let renamed = source;
  for (const span of spans) renamed = renamed.slice(0, span.start) + FRESH + renamed.slice(span.end);
  return renamed;
};

/** Evaluation results before and after renaming the `nth` occurrence of `name` and its references. */
const renamed = async (source: string, name: string, nth = 0) => {
  const after = renameAt(source, at(source, name, nth));
  return { before: await run(source), after: await run(after), source: after };
};

const definitionOf = (source: string, name: string, nth: number) => {
  const found = Editor.findReferences(index(source), { sourceId: "doc", offset: at(source, name, nth) });
  return found.definition;
};

// =============================================================================
// Existing patches (issues 11-15)
// =============================================================================

describe("patched issues stay fixed", () => {
  test("11: nested, rest, and keyed destructuring bind author symbols in let and fn", async () => {
    const source =
      "(let [[a [b c] & r] [1 [2 3] 4 5] {:k x :keys [y]} {:k 6 :y 7}] ((fn [[p & q]] (+ a b c p x y (count r) (count q))) [8 9]))";
    for (const name of ["a", "b", "c", "r", "x", "y", "p", "q"]) {
      expect(definitionOf(source, name, 1)?.span.start, name).toBe(at(source, name));
    }
    for (const name of ["a", "r", "x", "p", "q"]) {
      const result = await renamed(source, name);
      expect(result.after, name).toBe(result.before);
    }
  });

  test("12: a define inside a let or fn body is a global; a parameter still shadows it", async () => {
    const source = "(define (f x) (define x 9) x)\n(let [y 1] (define z y))\n[(f 1) x z]";
    expect(await run(source)).toBe("[1 9 1]");
    expect(definitionOf(source, "x", 2)).toMatchObject({ scope: "local", kind: "parameter" });
    expect(definitionOf(source, "x", 3)?.span.start).toBe(at(source, "x", 1));
    expect(definitionOf(source, "z", 1)?.span.start).toBe(at(source, "z"));
    for (const [name, nth] of [["x", 1], ["z", 0], ["x", 0]] as const) {
      const result = await renamed(source, name, nth);
      expect(result.after, `${name}#${nth}`).toBe(result.before);
    }
  });

  test("13: template binders stay out of the index at every expansion site", () => {
    const source = "(define-macro m [a] `(let [tmp ~a] tmp))\n(m 1)\n(m 2)\ntmp";
    const symbols = index(source);
    expect(symbols.definitions.map((definition) => definition.name)).toEqual(["m", "a"]);
    expect(symbols.references.find((reference) => reference.name === "tmp")?.resolution).toBe(
      "unresolved",
    );
  });

  test("13: an author symbol a macro places in binder position is a local definition", async () => {
    const source = "(define-macro with [name val body] `(let [~name ~val] ~body))\n(with x 1 (+ x 1))";
    expect(definitionOf(source, "x", 1)?.span.start).toBe(at(source, "x"));
    const result = await renamed(source, "x");
    expect(result).toMatchObject({ before: "2", after: "2" });
  });

  test("14: a repeated source id keeps its first load position with its last text", () => {
    const symbols = Editor.indexSymbols([
      { sourceId: "lib", source: "(define x 1)" },
      { sourceId: "doc", source: "x\n(define x 2)" },
      { sourceId: "lib", source: "(define x 3)" },
    ]);
    // `x` in doc is evaluated before doc's own define, so it reads lib's.
    const reference = symbols.references.find((candidate) => candidate.sourceId === "doc");
    expect(reference?.definition).toMatch(/^lib#/);
    expect(symbols.definitions.filter((definition) => definition.sourceId === "lib")).toHaveLength(1);
  });

  test("15: same-named globals in two files resolve as the concatenated program does", async () => {
    const lib = "(define x 1)";
    const doc = "(define before x)\n(define x 2)\n(define after x)";
    const symbols = Editor.indexSymbols([
      { sourceId: "lib", source: lib },
      { sourceId: "doc", source: doc },
    ]);
    const refs = symbols.references.filter((reference) => reference.name === "x");
    expect(refs.map((reference) => reference.definition?.split("#")[0])).toEqual(["lib", "doc"]);
    // The joined session program (LanguageSession.joinedSourceText) agrees.
    expect(await run(`${lib}\n${doc}\n[before after]`)).toBe("[1 2]");
  });
});

// =============================================================================
// Semantics the index already models correctly
// =============================================================================

describe("scoping rules that agree with the evaluator", () => {
  test.each([
    ["let is sequential: a value sees earlier binders", "(let [x 1 x (+ x 1)] x)", "x", 1],
    ["a let value does not see its own binder", "(define x 2)\n(let [x (+ x 1)] x)", "x", 0],
    ["closures capture the binder in scope where they are written", "(let [x 1] (let [f (fn [] x) x 2] (f)))", "x", 0],
    ["a local shadows a builtin", "(let [count (fn [v] 99)] (count [1]))", "count", 0],
    ["a local named like a macro does not stop the macro", "(let [cond 1] (cond :else cond))", "cond", 0],
    ["variadic rest parameters", "((fn [a & more] (count more)) 1 2 3)", "more", 0],
    ["a global referenced before its define in a fn body", "(define (f) (g))\n(define (g) 1)\n(f)", "g", 1],
    ["self-recursion through define", "(define f (fn [n] (if (= n 0) 0 (f (- n 1)))))\n(f 3)", "f", 0],
    ["match vector patterns with distinct variables", "(match [1 [2 3]] [a [b c]] (+ a b c))", "b", 0],
    ["match map patterns", "(match {:k 4} {:k v} v)", "v", 0],
  ])("%s", async (_label, source, name, nth) => {
    const result = await renamed(source, name, nth);
    expect(result.after).toBe(result.before);
    expect(result.before).not.toBe("error");
  });

  test("an argument captured by a macro's binder is not reported as the outer binder's reference", async () => {
    // Expansion is unhygienic: (let [t 5] (let [t 1] t)) evaluates to 1.
    const source = "(define-macro m [e] `(let [t 1] ~e))\n(let [t 5] (m t))";
    expect(await run(source)).toBe("1");
    const found = Editor.findReferences(index(source), { sourceId: "doc", offset: at(source, "t", 1) });
    expect(found.references).toEqual([]);
  });

  test("expanded metadata distinguishes macro data from executable arguments", () => {
    const source = "(define-macro data [x] `(quote ~x))\n(define-macro own [x] `(let [tmp ~x] (+ tmp 1)))\n(data (unknown 1))\n(own 2)";
    const symbols = index(source);
    const unknown = symbols.identities.doc!.nodes.find((node) => source.slice(node.span.start, node.span.end) === "(unknown 1)")!;
    expect(symbols.expressionNodeIds?.doc).not.toContain(unknown.id);
    const internal = symbols.expandedReferences?.find((reference) => reference.name === "tmp");
    expect(internal).toMatchObject({ bindingScope: "local" });
    expect(internal?.bindingCallNodeId).toBe(internal?.callNodeId);
  });

  test("global searches include every definition site but retain the primary definition", () => {
    const source = "(define x 5)\n(define x (+ x 1))\nx";
    const symbols = index(source);
    const found = Editor.findReferences(symbols, { sourceId: "doc", offset: at(source, "x", 2) });
    expect(found.definition?.span.start).toBe(at(source, "x"));
    expect(found.definitionSites).toHaveLength(2);
    expect(found.references).toHaveLength(2);
    for (const site of found.definitionSites!) expect(Editor.findReferences(symbols, { sourceId: "doc", nodeId: site.nodeId }).references).toEqual(found.references);
  });

  test("property: renaming a binder and its reported references preserves evaluation", async () => {
    await fc.assert(
      fc.asyncProperty(program(false), fc.nat(), async (source, pick) => {
        const definitions = index(source).definitions;
        if (definitions.length === 0) return;
        const definition = definitions[pick % definitions.length]!;
        const after = renameAt(source, definition.span.start);
        expect({ source, definition: definition.name, result: await run(after) }).toEqual({
          source,
          definition: definition.name,
          result: await run(source),
        });
      }),
      { numRuns: runs(150), seed: 7 },
    );
  }, 60_000);
});

// =============================================================================
// Siblings: index and evaluator disagree
// =============================================================================

describe("index and evaluator disagree", () => {
  test("a local named like a special form does not capture the form", async () => {
    // Root cause: walkList only treats some special-form heads (fn/let/define/match…) as forms; `if`/`do` fall through to a call and resolve to the local, but the VM compiles them as special forms first.
    const result = await renamed("(let [if (fn [a b c] 42)] (if true 1 2))", "if");
    expect(result.after).toBe(result.before); // before 1, after 42
  });

  test("a reference in a fn body reads the latest redefinition", async () => {
    // Root cause: SymbolWalker.global picks "latest define before the reference" statically, but globals are one mutable cell read at call time.
    const result = await renamed("(define x 1)\n(define (f) x)\n(define x 2)\n(f)", "x");
    expect(result.after).toBe(result.before); // before 2, after 1
  });

  test("a redefinition's value reads the previous definition", async () => {
    // Root cause: SymbolWalker.global counts a define as "before" its own value expression, so (define x (+ x 1)) resolves the inner x to itself.
    const result = await renamed("(define x 5)\n(define x (+ x 1))\nx", "x", 1);
    expect(result.after).toBe(result.before); // before 6, after error
  });

  test("a nested define updates builtin references compiled before it", async () => {
    // Every executable define reserves the shared global cell before compilation.
    const source = "(define (g) (count [1 2]))\n(define (setup) (define count (fn [v] 99)))\n(setup)\n(g)";
    const result = await renamed(source, "count", 1);
    expect(result.after).toBe(result.before); // Both calls now read the updated global cell.
  });

  test.each([
    ["builtin before and after nested redefinition", "(define (g) (count [1 2]))\n(define before (g))\n(define (setup) (define count (fn [v] 99)))\n(setup)\n[before (g)]", "[2 99]"],
    ["an unexecuted branch keeps the builtin", "(define (g) (count [1 2]))\n(if false (define count (fn [v] 99)) nil)\n(g)", "2"],
    ["an uncalled nested closure keeps the builtin", "(define (g) (count [1 2]))\n(define (setup) (fn [] (define count (fn [v] 99))))\n(setup)\n(g)", "2"],
    ["a called nested closure changes the shared cell", "(define (g) (count [1 2]))\n(define (setup) (fn [] (define count (fn [v] 99))))\n((setup))\n(g)", "99"],
    ["quasiquoted definitions are data", "(define (g) (count [1 2]))\n`(define count 99)\n(g)", "2"],
    ["type positions are data", "(define (g) (count [1 2]))\n(define-type (Phantom a) (Value (define count 99)))\n(g)", "2"],
    ["pattern positions are data", "(define (g) (count [1 2]))\n(match [1 2] (define count) 0)\n(g)", "2"],
    ["active unquotes contain executable definitions", "(define (g) (count [1 2]))\n`(~(define count (fn [v] 99)))\n(g)", "99"],
    ["first-class builtin values remain callable", "(define original count)\n(if true (define count (fn [v] 99)) nil)\n[(original [1 2]) (count [1 2])]", "[2 99]"],
    ["local bindings shadow reserved builtin cells", "(if true (define count (fn [v] 99)) nil)\n[(let [count (fn [v] 7)] (count [1])) (count [1])]", "[7 99]"],
  ])("%s", async (_label, source, expected) => {
    expect(await run(source)).toBe(expected);
  });

  test("a global defined by an active unquote is indexed in the same cell", () => {
    const source = "(define (g) (count [1 2]))\n`(~(define count (fn [v] 99)))\n(g)";
    const symbols = index(source);
    const found = Editor.findReferences(symbols, { sourceId: "doc", offset: at(source, "count", 1) });
    expect(found.definition).toMatchObject({ name: "count", scope: "global" });
    expect(found.references.map((reference) => reference.span.start)).toEqual([at(source, "count")]);
  });

  test("dynamic builtin calls retain observation values and failure locations", async () => {
    for (const argument of ["[1 2]", "1"]) {
      const source = `(define (g) (count ${argument}))\n(if false (define count (fn [v] 99)) nil)\n(g)`;
      const plain = await Engine.evaluate({ source });
      const observed = await Engine.evaluate({ source, observe: {} });
      expect(observed.printed).toEqual(plain.printed);
      expect(observed.diagnostics).toEqual(plain.diagnostics);
      expect(observed.observations?.records.length).toBeGreaterThan(0);
      if (plain.diagnostics.length > 0) expect(observed.observations?.records.some((record) => record.failure)).toBe(true);
    }
  });

  test("property: builtin cells retain their initial value until a nested definition executes", async () => {
    await fc.assert(fc.asyncProperty(
      fc.boolean(), fc.integer({ min: 10, max: 99 }), fc.integer({ min: 0, max: 5 }), fc.constantFrom("count", "+"),
      async (execute, replacement, input, name) => {
        const args = name === "count" ? `[${Array.from({ length: input }, () => "0").join(" ")}]` : `${input} 1`;
        const params = name === "count" ? "[v]" : "[x y]";
        const initial = name === "count" ? input : input + 1;
        const source = `(define (read) (${name} ${args}))\n(define before (read))\n(define (setup) (if ${execute} (define ${name} (fn ${params} ${replacement})) nil))\n(setup)\n[before (read)]`;
        expect(await run(source)).toBe(`[${initial} ${execute ? replacement : initial}]`);
      },
    ), { numRuns: runs(150), seed: 39 });
  }, 60_000);

  test("symbols in a runtime quasiquote are data, not references", async () => {
    // Root cause: walkTemplate treats every quasiquote as a macro template and resolves its bare symbols to globals.
    const result = await renamed("(define a 1)\n`(a ~a)", "a");
    expect(result.after).toBe(result.before); // before (a 1), after (fresh_q 1)
  });

  test("an introduced template reference records capture at the expansion site", () => {
    const source = "(define (helper v) 1)\n(define-macro m [v] `(helper ~v))\n(let [helper (fn [v] 2)] (m 0))";
    const symbols = index(source);
    const local = symbols.definitions.find((definition) => definition.name === "helper" && definition.scope === "local")!;
    expect(symbols.expandedReferences?.find((reference) => reference.name === "helper" && !reference.nodeId)).toMatchObject({ binding: local.key, bindingScope: "local" });
    // A semantic rename must reject this change: the introduced reference has no author token to edit.
  });

  test("a binder inside a macro template is not a reference to a same-named global", async () => {
    // Root cause: walkTemplate reports every bare template symbol, including let binders, as a reference to a global of that name.
    const source = "(define-macro m [e] `(let [t 1] (+ t ~e)))\n(define t 5)\n(m t)";
    const result = await renamed(source, "t", 2);
    expect(result.after).toBe(result.before); // before 2, after error
  });

  test("a global introduced by a macro template is a definition", () => {
    // Root cause: the issue-13 patch drops every binder whose origin is in a macro template, including a `define` the template introduces.
    const source = "(define-macro defconst [] `(define answer 42))\n(defconst)\nanswer";
    const reference = index(source).references.find((candidate) => candidate.name === "answer");
    expect(reference?.resolution).toBe("definition"); // evaluates to 42; index says unresolved
  });

  test("list pattern heads follow the typechecker's constructor interpretation", async () => {
    const source = "(define a 9)\n(match [1 2] (a b) a)";
    expect(await run(source)).toBe("1");
    expect(definitionOf(source, "a", 2)).toMatchObject({ scope: "global" });
    // Runtime treats this head as a binder; this known language discrepancy is documented.
  });

  test("a repeated match variable is one binding", () => {
    // Root cause: bindMatchPattern defines each occurrence separately; compileMatchPattern makes repeats an equality test on one binding.
    const source = "(match [1 1] [x x] x _ 0)";
    const found = Editor.findReferences(index(source), { sourceId: "doc", offset: at(source, "x") });
    expect(found.references.map((reference) => reference.span.start)).toContain(at(source, "x", 2));
  });

  test("a type variable is not a reference to a same-named value", () => {
    // Root cause: walkType resolves every symbol in a type expression against globals, so the parameter `a` of (Option a) matches the value `a`.
    const source = "(define a 1)\n(define-type (Option a) (Some a) (None))";
    const found = Editor.findReferences(index(source), { sourceId: "doc", offset: at(source, "a") });
    expect(found.references).toEqual([]);
  });

  test("keywords cannot be bound", () => {
    // Root cause: bindPattern defines any symbol; the VM compiles keywords as constants before looking up locals.
    expect(index("(let [:k 1] :k)").definitions).toEqual([]);
  });

  test("fn has no named form", async () => {
    // Root cause: walkFunction accepts (fn name [params] …), which neither evalFn nor compileFn supports.
    const source = "((fn f [x] x) 1)";
    expect(await run(source)).toBe("error");
    expect(index(source).definitions.map((definition) => definition.name)).toEqual(["x"]);
  });

  test("define sugar reuses fn parameter destructuring", async () => {
    // The same fn lowering handles destructuring in the define signature.
    expect(await run("(define (f [a b]) (+ a b))\n(f [1 2])")).toBe("3");
  });

  test("property: renaming survives global redefinition", async () => {
    // Counterexample of the redefinition sibling above, found by generation.
    await fc.assert(
      fc.asyncProperty(program(true), fc.nat(), async (source, pick) => {
        const definitions = index(source).definitions;
        const definition = definitions[pick % definitions.length]!;
        expect(await run(renameAt(source, definition.span.start))).toBe(await run(source));
      }),
      { numRuns: runs(150), seed: 7 },
    );
  }, 60_000);
});

// =============================================================================
// Program generator
// =============================================================================

const LOCALS = ["a", "b", "c"] as const;

/** A well-scoped expression over `bound` names; `call` allows calls to the global `h`. */
function expr(bound: readonly string[], depth: number, call: boolean): fc.Arbitrary<string> {
  const number = fc.integer({ min: 0, max: 5 }).map(String);
  const leaf = bound.length > 0 ? fc.oneof(number, fc.constantFrom(...bound)) : number;
  if (depth === 0) return leaf;
  const sub = (names: readonly string[] = []) => expr([...new Set([...bound, ...names])], depth - 1, call);
  const local = fc.constantFrom(...LOCALS);
  const pair = fc.uniqueArray(local, { minLength: 2, maxLength: 2 }) as fc.Arbitrary<string[]>;
  return fc.oneof(
    leaf,
    fc.tuple(fc.constantFrom("+", "-"), sub(), sub()).map(([op, l, r]) => `(${op} ${l} ${r})`),
    fc.tuple(sub(), sub(), sub(), sub()).map(([l, r, t, e]) => `(if (< ${l} ${r}) ${t} ${e})`),
    fc.tuple(local, local).chain(([x, y]) =>
      fc.tuple(sub(), sub([x]), sub([x, y])).map(([v, w, body]) => `(let [${x} ${v} ${y} ${w}] ${body})`),
    ),
    pair.chain(([x, y]) =>
      fc.tuple(sub([x!, y!]), sub(), sub()).map(([body, l, r]) => `((fn [${x} ${y}] ${body}) ${l} ${r})`),
    ),
    pair.chain(([x, y]) =>
      fc.tuple(sub(), sub(), sub([x!, y!])).map(([l, r, body]) => `(match [${l} ${r}] [${x} ${y}] ${body})`),
    ),
    pair.chain(([x, y]) =>
      fc.tuple(sub(), sub(), sub([x!, y!])).map(([l, r, body]) => `(let [[${x} ${y}] [${l} ${r}]] ${body})`),
    ),
    ...(call ? [sub().map((arg) => `(h ${arg})`)] : []),
  );
}

/** Small well-scoped programs: a global, a function over it, and a call. */
function program(redefine: boolean): fc.Arbitrary<string> {
  return redefine
    ? fc
        .tuple(fc.integer({ min: 0, max: 5 }), fc.integer({ min: 6, max: 9 }), expr(["g"], 2, false))
        .map(([first, second, arg]) => `(define-macro m [e] \`(let [macro-tmp ~e] (+ macro-tmp 1)))\n(define g ${first})\n(define (h a) (+ a g))\n(define g ${second})\n(m (h ${arg}))`)
    : fc
        .tuple(expr([], 3, false), expr(["a", "g"], 3, false), expr(["g"], 3, true))
        .map(([value, body, main]) => `(define-macro m [e] \`(let [macro-tmp ~e] (+ macro-tmp 1)))\n(define g ${value})\n(define (h a) ${body})\n(m ${main})`);
}
