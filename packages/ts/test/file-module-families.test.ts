import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { checkModuleGraph, resolveModuleGraph, sourceModuleResolver } from "../src/Modules.js";

const graph = (source: string, library: string, extra: { id: string; source: string }[] = []) => resolveModuleGraph(
  { id: "main.lisp", source },
  sourceModuleResolver([{ id: "library.lisp", source: library }, ...extra]),
);
const computedLibrary = `
(export group)
(type PartIR {:label String})
(type parts (Union PartIR))
(form (part label) :types {:label String} :ir PartIR {:label label})
(type GroupIR {:children (List PartIR)})
(form (group name child ...) :types {:name (Declares GroupDef) :child (List parts)} :ir GroupIR {:children child})`;

// Probes written before changing evaluateHole: none of these computed family
// children was accepted by the linked path, even when evaluation produced IR.
test.each([
  '(let [x {:label "A"}] x)',
  '(make-part "A")',
  'built',
])("computed family child baseline: %s", child => {
  expect(() => graph(`(import "./library.lisp" [group])
    (define make-part [label] {:label label}) (define built {:label "A"})
    (group example ${child})`, computedLibrary)).toThrow(/Expected child form/);
});

test("an unqualified local declaration shadows a builtin", () => {
  const g = graph('(import "./library.lisp" [answer])', '(export answer) (define map [x] (+ x 1)) (define answer (map 41))');
  expect(checkModuleGraph(g).diagnostics).toEqual([]);
  expect(g.modules[0]!.interface.exports.find(b => b.name === "answer")?.data?.value).toBe(42);
});

const singleLibrary = computedLibrary.replace('(group name child ...)', '(group name child)').replace(':child (List parts)', ':child parts').replace('{:children child}', '{:children [child]}');
test.each([
  ['(let [x (make-part "A")] x)', false],
  ['(make-part "A")', false],
  ['built', true],
  ['{:label "A"}', true],
] as const)("single computed child baseline: %s", (child, works) => {
  const run = () => graph(`(import "./library.lisp" [group])
    (define make-part [label] {:label label}) (define built {:label "A"})
    (group example ${child})`, singleLibrary);
  if (works) expect(checkModuleGraph(run()).diagnostics).toEqual([]);
  else expect(run).toThrow(/Expected child form/);
});

const fixture = (name: string) => readFileSync(new URL(`../../../conformance/file-module-families/${name}.lisp`, import.meta.url), "utf8");
test("qualified file declarations and namespace access", () => {
  const g = graph('(import "./library.lisp" :as lib) (lib/flow hello) (lib/flow-child/step "A")', fixture("qualified"));
  expect(checkModuleGraph(g).diagnostics).toEqual([]);
});
test.each(['diag/error', 'diag/custom'])("qualified local %s follows builtin shadowing", symbol => {
  const g = graph('(import "./library.lisp" [answer])', `(export answer) (define ${symbol} [x] (+ x 1)) (define answer (${symbol} 41))`);
  expect(checkModuleGraph(g).diagnostics).toEqual([]);
  expect(g.modules[0]!.interface.exports.find(b => b.name === "answer")?.data?.value).toBe(42);
});
test("qualified duplicate declarations retain their diagnostic", () => {
  expect(() => graph('(import "./library.lisp" [flow-child/step])', fixture("collision"))).toThrowError(expect.objectContaining({ diagnostic: expect.objectContaining({ code: "module/duplicate-declaration" }) }));
});
test.each([false, true])("namespace conflicts do not depend on import order (%s)", reversed => {
  const directives = ['(import "./other.lisp" :as flow-child)', '(import "./library.lisp" [flow-child/step])'];
  if (reversed) directives.reverse();
  expect(() => graph(directives.join('\n'), fixture("qualified"), [{ id: "other.lisp", source: '(export step) (define step 1)' }]))
    .toThrowError(expect.objectContaining({ diagnostic: expect.objectContaining({ code: "module/duplicate-import" }) }));
});

test("nested references and mixed alias records keep semantic checks", () => {
  const g = graph('(import "./library.lisp" [item catalog]) (catalog c :items [a] :selection {:target a :count (+ 1 1)}) (item a)', fixture("references"));
  expect(checkModuleGraph(g).diagnostics).toEqual([]);
});
test.each([
  [':items [missing] :selection {:target a :count 1}', 'elaborate/unknown-reference'],
  [':items [c] :selection {:target a :count 1}', 'elaborate/reference-type'],
  [':items [a] :selection {:target missing :count 1}', 'elaborate/unknown-reference'],
  [':items [1] :selection {:target a :count 1}', 'elaborate/hole-type'],
])("nested reference rejection %s", (holes, code) => {
  expect(() => graph(`(import "./library.lisp" [item catalog]) (catalog c ${holes}) (item a)`, fixture("references")))
    .toThrowError(expect.objectContaining({ diagnostic: expect.objectContaining({ code }) }));
});
test("mixed records still check ordinary fields", () => {
  expect(() => graph('(import "./library.lisp" [item catalog]) (catalog c :items [a] :selection {:target a :count "bad"}) (item a)', fixture("references")))
    .toThrow(/count must be Int/);
});

test("private nested children use owner hooks and caller values", () => {
  const g = graph('(import "./library.lisp" [layout]) (define text [x] "shadow") (define label "A") (layout page (panel (text label)))', fixture("nested"));
  expect(checkModuleGraph(g).diagnostics).toEqual([]);
  expect(g.modules.at(-1)!.compileTime!.elaborated()[0]!.ir).toEqual(new Map([
    [':name', expect.anything()], [':children', [new Map([[':children', [new Map([[':label', 'A!']])]]])]],
  ]));
});
test("private child checks retain authored locations", () => {
  const source = '(import "./library.lisp" [layout]) (layout page (panel (text "bad")))';
  expect(() => graph(source, fixture("nested"))).toThrowError(expect.objectContaining({ diagnostic: expect.objectContaining({
    code: "E_LABEL", message: "Invalid label", span: expect.objectContaining({ startOffset: source.indexOf('"bad"') }),
  }) }));
});
