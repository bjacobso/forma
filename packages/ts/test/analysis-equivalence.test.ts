import { describe, expect, test } from "vitest";
import fc from "fast-check";
import { AnalysisWorkspace } from "../src/analysis/workspace.js";
import { identifySyntax } from "../src/syntax/identity.js";

const sourceId = "document.lisp";
const prelude = `(define base 10)
(macro (twice x) \`(+ ~x ~x))
(type Choice (Tagged (Some Int) None))`;

// Keep forms separate so every operation edits exactly one top-level form.
const corpus = [
  ["(define a 1)", "(define b (+ a base))", "b"],
  ["(define id (fn [x] x))", "(define a (id 1))", '(id "text")'],
  ["(: a Int)", "(define a 1)", "(define b (+ a 2))", "b"],
  ["(macro (inc x) `(+ ~x 1))", "(define a (inc 1))", "(twice a)"],
  ["(define a b)", "(define b 1)", "a"],
  ["(define a (fn [x] (b x)))", "(define b (fn [x] (a x)))", "a"],
  ["(type Local Int)", "(: a Local)", "(define a 1)", "a"],
  ["(define a ?goal)", '(+ a "wrong")', "(define b 2)"],
  ["(define a (Some 1))", "(match a (Some x) x None 0)"],
];

const replacements = [
  "(define a 2)",
  '(define a "changed")',
  "(define a (fn [x] x))",
  "(define a (+ b 1))",
  "(define a ?goal)",
  "(define renamed 1)",
  "(: a Int)",
  "(: a String)",
  "(type Local String)",
  "(macro (inc x) `(+ ~x 2))",
  "(define broken (fn [x]",
  "a",
];

const edit = fc.record({
  kind: fc.constantFrom("insert", "delete", "rename", "body", "signature"),
  index: fc.nat({ max: 100 }),
  replacement: fc.constantFrom(...replacements),
});

function applyEdit(forms: string[], operation: { kind: string; index: number; replacement: string }): void {
  const index = operation.index % Math.max(forms.length, 1);
  switch (operation.kind) {
    case "insert":
      forms.splice(operation.index % (forms.length + 1), 0, operation.replacement);
      break;
    case "delete":
      forms.splice(index, 1);
      break;
    case "rename":
      if (forms[index] !== undefined) forms[index] = forms[index]!.replace(/\ba\b/g, "renamed");
      break;
    case "body":
      forms.splice(index, 1, operation.replacement);
      break;
    case "signature":
      forms.splice(index, 1, operation.index % 2 ? "(: a String)" : "(: a Int)");
      break;
  }
}

function workspace(): AnalysisWorkspace {
  const result = new AnalysisWorkspace();
  result.setPrelude("prelude.lisp", prelude);
  return result;
}

function observable(workspace: AnalysisWorkspace, source: string, bindingNames: Set<string>) {
  const analysis = workspace.analysis(sourceId);
  const symbols = workspace.symbols();
  // Retain probes after names disappear, so stale bindings remain observable.
  for (const item of [...symbols.definitions, ...symbols.references]) bindingNames.add(item.name);
  // Stable syntax ids intentionally differ after insert/delete. Compare their
  // author-visible meaning, including where each reference resolves, instead.
  return {
    resultType: analysis.resultType,
    diagnostics: analysis.diagnostics,
    typedSpans: analysis.typedSpans,
    bindings: [...bindingNames].sort().map(name => [name, analysis.hasBinding(name), analysis.bindingDisplay(name)]),
    documentSymbols: workspace.documentSymbols(sourceId),
    definitions: symbols.definitions.map(({ key: _key, nodeId: _nodeId,
      formNodeId: _formNodeId, scopeNodeId: _scopeNodeId, ...definition }) => definition),
    references: symbols.references.map(({ nodeId: _nodeId, definition, ...reference }) => {
      const target = symbols.definitions.find(candidate => candidate.key === definition);
      return { ...reference, target: target && { name: target.name, sourceId: target.sourceId, span: target.span } };
    }),
    hovers: identifySyntax(source).nodes.map(node => ({
      span: node.span,
      hover: workspace.hover(sourceId, node.span.start),
    })),
  };
}

describe("analysis cold/warm equivalence", () => {
  test.each(corpus.map((forms, index) => ({ forms, index })))(
    "matches cold analysis after single-form edits (corpus $index)",
    ({ forms: initial }) => {
      fc.assert(fc.property(fc.array(edit, { minLength: 5, maxLength: 15 }), operations => {
        const warm = workspace();
        const forms = [...initial];
        const bindingNames = new Set<string>();
        const compare = () => {
          const source = forms.join("\n");
          warm.setDocument(sourceId, source);
          const cold = workspace();
          cold.setDocument(sourceId, source);
          expect(observable(warm, source, bindingNames)).toEqual(observable(cold, source, bindingNames));
        };
        compare();
        for (const operation of operations) {
          applyEdit(forms, operation);
          compare();
        }
      }), { seed: 6004, numRuns: 10 * Number(process.env["FORMA_PROPERTY_SCALE"] ?? 1) });
    },
    60_000,
  );
});
