import { describe, expect, test } from "vitest";
import { AnalysisWorkspace } from "../src/analysis/workspace.js";

const sourceId = "document.lisp";

function independent(count: number, edited = -1, body = "(+ 1 2)"): string {
  return (
    Array.from({ length: count }, (_, i) =>
      i === edited ? `(define value-${i} ${body})` : `(define value-${i} (+ ${i} 1))`,
    ).join("\n") + `\nvalue-${count - 1}\n`
  );
}

function analyze(text: string): { workspace: AnalysisWorkspace; analysis: ReturnType<AnalysisWorkspace["analysis"]> } {
  const workspace = new AnalysisWorkspace();
  workspace.setDocument(sourceId, text);
  return { workspace, analysis: workspace.analysis(sourceId) };
}

function observe(workspace: AnalysisWorkspace) {
  const analysis = workspace.analysis(sourceId);
  return {
    resultType: analysis.resultType,
    typedSpans: analysis.typedSpans,
    diagnostics: analysis.diagnostics,
    bindings: ["value-0", "value-3", "f", "g", "id", "a", "b"].map((name) => analysis.bindingDisplay(name)),
  };
}

describe("per-SCC memoization", () => {
  test("a one-definition edit infers only the edited component", () => {
    const warm = new AnalysisWorkspace();
    warm.setDocument(sourceId, independent(500));
    warm.analysis(sourceId);
    expect(warm.sccMemoStats().lastRun).toMatchObject({ hits: 0, misses: 500, stores: 500 });

    warm.setDocument(sourceId, independent(500, 250, "(+ 250 7)"));
    const analysis = warm.analysis(sourceId);
    expect(warm.sccMemoStats().lastRun).toMatchObject({ hits: 499, misses: 1, stores: 1 });

    const cold = analyze(independent(500, 250, "(+ 250 7)"));
    expect(observe(warm)).toEqual(observe(cold.workspace));
    expect(analysis.resultType).toBe("Int");
  });

  test("shifted spans are reprojected, not replayed", () => {
    const warm = new AnalysisWorkspace();
    warm.setDocument(sourceId, "(define a 1)\n(define b (fn [x] x))\nb");
    warm.analysis(sourceId);
    const shifted = "(define pad 0)\n(define a 1)\n(define b (fn [x] x))\nb";
    warm.setDocument(sourceId, shifted);
    expect(warm.sccMemoStats().lastRun.hits).toBe(0);
    warm.analysis(sourceId);
    expect(warm.sccMemoStats().lastRun.hits).toBe(2);
    const cold = analyze(shifted);
    expect(observe(warm)).toEqual(observe(cold.workspace));
    expect(warm.symbols().definitions.map((d) => d.span)).toEqual(
      cold.workspace.symbols().definitions.map((d) => d.span),
    );
  });

  test("recursive SCC edits rebuild the whole component and match cold analysis", () => {
    const forms = [
      "(define f (fn [x] (g x)))",
      "(define g (fn [x] (f x)))",
      "(define id (fn [x] x))",
      "(id 1)",
    ];
    const warm = new AnalysisWorkspace();
    warm.setDocument(sourceId, forms.join("\n"));
    warm.analysis(sourceId);
    for (const edited of [
      ["(define f (fn [x] x))", ...forms.slice(1)], // SCC split
      ["(define f (fn [x] (g x)))", "(define g (fn [x] x))", ...forms.slice(2)],
      forms, // SCC merge
    ]) {
      const source = edited.join("\n");
      warm.setDocument(sourceId, source);
      expect(observe(warm)).toEqual(observe(analyze(source).workspace));
    }
  });

  test("changing a referenced scheme invalidates its users", () => {
    const warm = new AnalysisWorkspace();
    warm.setDocument(sourceId, "(define a 1)\n(define b (+ a 1))\nb");
    warm.analysis(sourceId);
    warm.setDocument(sourceId, '(define a "text")\n(define b (+ a 1))\nb');
    const analysis = warm.analysis(sourceId);
    expect(analysis.diagnostics.length).toBeGreaterThan(0);
    expect(observe(warm)).toEqual(observe(analyze('(define a "text")\n(define b (+ a 1))\nb').workspace));
  });

  test("holes, declarations and failed definitions fall back to full analysis", () => {
    for (const source of [
      "(define a ?goal)\n(define b 2)\nb",
      "(type Local Int)\n(define a 1)\na",
      "(macro (inc x) `(+ ~x 1))\n(define a (inc 1))\na",
      "(define a (+ 1 \"x\"))\n(define b 2)\nb",
    ]) {
      const warm = new AnalysisWorkspace();
      warm.setDocument(sourceId, source);
      warm.analysis(sourceId);
      warm.setDocument(sourceId, `${source}\n(define zz 9)`);
      warm.analysis(sourceId);
      expect(observe(warm)).toEqual(observe(analyze(`${source}\n(define zz 9)`).workspace));
    }
  });

  test("unresolved numeric obligations stay out of the cache", () => {
    const source = "(define add (fn [x y] (+ x y)))\n(define n (add 1 2))\n(define f (add 1.5 2))\nn";
    const warm = new AnalysisWorkspace();
    warm.setDocument(sourceId, source);
    warm.analysis(sourceId);
    warm.setDocument(sourceId, `${source}\n(define pad 1)`);
    expect(observe(warm)).toEqual(observe(analyze(`${source}\n(define pad 1)`).workspace));
  });

  test("the cache is bounded and released with its workspace", () => {
    const warm = new AnalysisWorkspace();
    for (let i = 0; i < 40; i++) {
      warm.setDocument(sourceId, `(define value-${i} (+ ${i} 1))\nvalue-${i}`);
      warm.analysis(sourceId);
    }
    expect(warm.sccMemoStats().entries).toBeLessThanOrEqual(4096);
  });
});
