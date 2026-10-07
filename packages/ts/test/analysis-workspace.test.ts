import { describe, expect, test } from "vitest";

import { Analysis } from "../src/index.js";

const PRELUDE = `(macro (twice x) \`(+ ~x ~x))
(define base 10)
(type WorkflowIR {:trigger String :steps (Option (List String))})
(form (workflow name {:keys [trigger steps]})
  "A named sequence of steps."
  :types {:name (Declares Workflow) :trigger String :steps (Option (List String))}
  :ir WorkflowIR {:trigger trigger :steps steps})
`;

/** Offset of the `nth` occurrence of `text`, plus `delta`. */
const at = (source: string, text: string, delta = 0, nth = 0) => {
  let found = -1;
  for (let count = 0; count <= nth; count++) {
    found = source.indexOf(text, found + 1);
    if (found < 0) throw new Error(`no ${text}`);
  }
  return found + delta;
};

const workspace = (document: string, prelude = PRELUDE) => {
  const result = new Analysis.AnalysisWorkspace();
  result.setPrelude("prelude.lisp", prelude);
  result.setDocument("doc.lisp", document);
  return result;
};

describe("AnalysisWorkspace", () => {
  test("types documents with the definitions and macros of their preludes", () => {
    const source = "(define double (fn [n] (twice n)))\n(double base)";
    const analysis = workspace(source).analysis("doc.lisp");
    expect(analysis.diagnostics).toEqual([]);
    expect(analysis.resultType).toBe("Number");
    expect(analysis.typeEnv.get("base")).toBeDefined();
  });

  test("keeps typing the forms around one that does not parse", () => {
    const source = "(define one 1)\n(define broken (fn [x]\n";
    const ws = workspace(source);
    const diagnostics = ws.diagnostics("doc.lisp");
    expect(diagnostics.map((diagnostic) => diagnostic.code)).toContain("parse/syntax");
    expect(ws.typeAt("doc.lisp", at(source, "one"))?.type).toBe("Int");
  });

  test("keeps typing the forms around one that does not lower", () => {
    const source = "(macro (inc x) `(+ ~x 1))\n(form bad)\n(define two (inc 1))";
    const ws = workspace(source);
    const messages = ws.diagnostics("doc.lisp").map((diagnostic) => diagnostic.message);
    expect(messages.some((message) => message.includes("form expects"))).toBe(true);
    expect(messages.some((message) => message.includes("Unbound"))).toBe(false);
    expect(ws.analysis("doc.lisp").typeEnv.get("two")).toBeDefined();
  });

  test("reports type errors at their source", () => {
    const source = '(define ok 1)\n(+ 1 "nope")';
    const [diagnostic] = workspace(source).diagnostics("doc.lisp");
    expect(diagnostic).toMatchObject({ code: "typecheck/error", severity: "error" });
    expect(diagnostic?.message).toContain("Type mismatch");
    expect(diagnostic?.message).not.toContain("at offset");
  });

  test("hover shows the type of a name and where it is defined", () => {
    const source = "(define double (fn [n] (* n 2)))\n(double base)";
    const ws = workspace(source);
    expect(ws.hover("doc.lisp", at(source, "double", 1, 1))?.markdown).toContain(
      "double : Number -> Number",
    );
    const prelude = ws.hover("doc.lisp", at(source, "base", 1));
    expect(prelude?.markdown).toContain("base : Int");
    expect(prelude?.markdown).toContain("prelude.lisp");
  });

  test("hover on a described form shows its documentation and slots", () => {
    const source = '(workflow onboarding :trigger "hired")';
    const hover = workspace(source).hover("doc.lisp", at(source, "workflow", 1));
    expect(hover?.markdown).toContain("**form** `workflow`");
    expect(hover?.markdown).toContain("A named sequence of steps.");
    expect(hover?.markdown).toContain("`:trigger` (required)");
  });

  test("definitions and references cross from documents into preludes", () => {
    const source = "(twice base)\n(+ base 1)";
    const ws = workspace(source);
    expect(ws.definition("doc.lisp", at(source, "twice", 1))).toMatchObject({
      sourceId: "prelude.lisp",
      kind: "macro",
    });
    const references = ws.references("doc.lisp", at(source, "base", 1), { includeDeclaration: true });
    expect(references.map((span) => span.sourceId)).toEqual([
      "prelude.lisp",
      "doc.lisp",
      "doc.lisp",
    ]);
  });

  test("completion lists locals, document and prelude names, forms, and builtins", () => {
    const source = "(define (scale factor) (* factor ))";
    const items = workspace(source).completions("doc.lisp", at(source, " ))", 1));
    const byLabel = new Map(items.map((item) => [item.label, item]));
    expect(byLabel.get("factor")).toMatchObject({ kind: "parameter" });
    expect(byLabel.get("scale")).toMatchObject({ kind: "function" });
    expect(byLabel.get("base")).toMatchObject({ kind: "variable", detail: "Int" });
    expect(byLabel.get("workflow")).toMatchObject({ kind: "form" });
    expect(byLabel.get("map")).toMatchObject({ kind: "function" });
    expect(byLabel.get("factor")!.sortText < byLabel.get("map")!.sortText).toBe(true);
  });

  test("completion after a colon inside a described form lists its open slots", () => {
    const source = '(workflow onboarding :trigger "hired" :';
    const items = workspace(source).completions("doc.lisp", source.length);
    expect(items.map((item) => item.label)).toEqual([":steps"]);
    expect(items[0]).toMatchObject({
      kind: "slot",
      replace: { start: source.length - 1, end: source.length },
    });
  });

  test("rename changes a definition and its references, and refuses clashes", () => {
    const source = "(define (scale x) (* x 2))\n(scale 3)\n(define other 1)";
    const ws = workspace(source);
    const renamed = ws.rename("doc.lisp", at(source, "scale", 1, 1), "grow");
    expect(renamed.ok && renamed.edits.map((edit) => edit.span.startOffset)).toEqual([
      at(source, "scale"),
      at(source, "scale", 0, 1),
    ]);
    expect(ws.rename("doc.lisp", at(source, "scale", 1), "other")).toMatchObject({ ok: false });
    expect(ws.rename("doc.lisp", at(source, "scale", 1), "(bad")).toMatchObject({ ok: false });
    expect(ws.prepareRename("doc.lisp", at(source, "*", 0))).toBeUndefined();
    expect(ws.prepareRename("doc.lisp", at(source, "scale", 1, 1))).toMatchObject({
      startOffset: at(source, "scale", 0, 1),
    });
  });

  test("document symbols are the top-level definitions with their forms", () => {
    const source = "(define a 1)\n(define (f x) x)\n(type Color (Tagged Red Green))";
    const symbols = workspace(source).documentSymbols("doc.lisp");
    expect(symbols.map((symbol) => [symbol.name, symbol.kind])).toEqual([
      ["a", "value"],
      ["f", "function"],
      ["Color", "type"],
      ["Red", "constructor"],
      ["Green", "constructor"],
    ]);
    expect(symbols[1]?.span).toMatchObject({ startOffset: at(source, "(define (f") });
  });

  test("semantic tokens classify names by what defines them", () => {
    const source = '; note\n(define (f x) (twice x))\n(workflow onboarding)\n(f "s" 1 :k)';
    const { tokens, data } = workspace(source).semanticTokens("doc.lisp");
    const byText = (text: string, nth = 0) =>
      tokens.filter((token) => source.slice(token.start, token.end) === text)[nth];
    expect(byText("; note")?.type).toBe("comment");
    expect(byText("define")).toMatchObject({ type: "keyword", modifiers: ["defaultLibrary"] });
    expect(byText("f")).toMatchObject({ type: "function", modifiers: ["declaration", "definition"] });
    expect(byText("x")?.type).toBe("parameter");
    expect(byText("twice")?.type).toBe("macro");
    expect(byText("workflow")?.type).toBe("keyword");
    expect(byText("onboarding")).toMatchObject({ type: "class", modifiers: ["declaration", "definition"] });
    expect(byText("f", 1)).toMatchObject({ type: "function", modifiers: [] });
    expect(byText('"s"')?.type).toBe("string");
    expect(byText("1")?.type).toBe("number");
    expect(byText(":k")?.type).toBe("property");
    expect(data.length).toBe(tokens.length * 5);
    // The first token starts at line 0, column 0.
    expect(data.slice(0, 3)).toEqual([0, 0, 6]);
  });

  test("formats documents and declines ones that do not parse", () => {
    const ws = workspace("(define   x   1)");
    expect(ws.format("doc.lisp")).toBe("(define x 1)\n");
    ws.setDocument("doc.lisp", "(define x");
    expect(ws.format("doc.lisp")).toBeUndefined();
  });

  test("queries are memoized until an input they read changes", () => {
    const ws = workspace("(define a 1)");
    const first = ws.analysis("doc.lisp");
    expect(ws.analysis("doc.lisp")).toBe(first);
    const scopes = ws.preludeScopes();
    ws.setDocument("doc.lisp", "(define a 1)");
    expect(ws.analysis("doc.lisp")).toBe(first);
    ws.setDocument("doc.lisp", "(define a 2)");
    expect(ws.analysis("doc.lisp")).not.toBe(first);
    expect(ws.preludeScopes()).toBe(scopes);
    ws.setPrelude("prelude.lisp", `${PRELUDE}\n(define more 1)`);
    expect(ws.preludeScopes()).not.toBe(scopes);
  });

  test("an open prelude is analyzed in the scope of the preludes before it", () => {
    const ws = new Analysis.AnalysisWorkspace();
    ws.setPrelude("a.lisp", "(define a 1)");
    ws.setPrelude("b.lisp", "(define b (+ a 1))");
    expect(ws.diagnostics("b.lisp")).toEqual([]);
    expect(ws.analysis("b.lisp").typeEnv.get("b")).toBeDefined();
    expect(ws.analysis("a.lisp").typeEnv.has("b")).toBe(false);
  });
});
