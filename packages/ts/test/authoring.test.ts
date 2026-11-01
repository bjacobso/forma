import { describe, expect, it } from "vitest";
import { blank, descriptorForms, mergeReplSource, replDefinitions, requirementsFor } from "../src/Authoring.js";
import { identifySyntax, indexSyntax } from "../src/Syntax.js";

const source = `(define (send x) (Directory.lookup x))
(define (loop x) (if x (send x) (loop x)))
(loop true)
(define pure 42)`;

describe("UI-free authoring helpers", () => {
  it("propagates capabilities through resolved definitions and recursive calls", () => {
    const identity = identifySyntax(source);
    const syntax = indexSyntax(identity);
    const forms = syntax.children(null);
    const symbols = Object.fromEntries(identity.nodes.filter(node => node.kind === "Symbol").map(node => {
      const name = source.slice(node.span.start, node.span.end);
      return [node.id, { name, kind: name === "Directory.lookup" ? "capability" : "reference",
        ...(name === "send" || name === "loop" ? { definition: name } : {}) }];
    }));
    const requirements = requirementsFor(identity, symbols, [
      { key: "send", formNodeId: forms[0]!.id },
      { key: "loop", formNodeId: forms[1]!.id },
    ]);
    expect(requirements[forms[0]!.id]).toEqual(["Directory.lookup"]);
    expect(requirements[forms[1]!.id]).toEqual(["Directory.lookup"]);
    expect(requirements[forms[2]!.id]).toEqual(["Directory.lookup"]);
    expect(requirements[forms[3]!.id]).toBeUndefined();
    // A same-named symbol resolved to another definition cannot inherit authority.
    const loopCall = syntax.children(forms[2]!.id)[0]!;
    const shadowed = requirementsFor(identity, { ...symbols, [loopCall.id]: { name: "loop", kind: "local", definition: "other" } }, [
      { key: "send", formNodeId: forms[0]!.id }, { key: "loop", formNodeId: forms[1]!.id },
    ]);
    expect(shadowed[forms[2]!.id]).toBeUndefined();
  });

  it("replaces scratch declarations without dropping application expressions or imports", () => {
    expect(mergeReplSource('(import "./math.forma" [double])\n(define value 1)\n(+ value 2)', '(define value 9)\n(define (double x) (* x 2))'))
      .toBe('(import "./math.forma" [double])\n(+ value 2)\n(define value 9)\n(define (double x) (* x 2))');
    expect(mergeReplSource('(define (f x) x)', '(define (f x) (+ x 1))')).toBe('(define (f x) (+ x 1))');
    expect(mergeReplSource('(define value 1)', '(unfinished')).toBe('(define value 1)\n(unfinished');
  });

  it("keeps only declarations that do not require capabilities when preparing REPL context", () => {
    const identity = identifySyntax(source);
    const forms = indexSyntax(identity).children(null);
    const declarations = replDefinitions(source, { document: { source, identity }, requirements: {
      [forms[0]!.id]: ["Directory.lookup"], [forms[1]!.id]: ["Directory.lookup"],
    } });
    expect(declarations).toBe('(define pure 42)');
    expect(replDefinitions('(define x 1)\n(+ x 2)')).toBe('(define x 1)');
  });

  it("finds only top-level descriptor forms and blanks them without shifting source spans", () => {
    const text = '(policy demo\n  :name "🌳")\n(define x 1)\n(fn [] (policy nested))';
    const forms = descriptorForms(identifySyntax(text), text, head => head === "policy");
    expect(forms).toHaveLength(1);
    expect(text.slice(forms[0]!.start, forms[0]!.end)).toBe('(policy demo\n  :name "🌳")');
    const code = blank(text, forms);
    expect(code.length).toBe(text.length);
    expect(code.split('\n').map(line => line.length)).toEqual(text.split('\n').map(line => line.length));
    expect(code.indexOf('(define x 1)')).toBe(text.indexOf('(define x 1)'));
    expect(code).toContain('(fn [] (policy nested))');
  });
});
