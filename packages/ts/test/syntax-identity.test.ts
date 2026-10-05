import { describe, expect, test } from "vitest";
import fc from "fast-check";

import { Reader, Syntax } from "../src/index.js";
import { program } from "./support/programs.js";

const { identifySyntax, reconcileSyntax, indexSyntax } = Syntax;

const textOf = (source: string, node: Syntax.SyntaxNode) =>
  source.slice(node.span.start, node.span.end);

const idOf = (source: string, identity: Syntax.SyntaxIdentity, text: string, nth = 0) => {
  const matches = identity.nodes.filter((node) => textOf(source, node) === text);
  const node = matches[nth];
  if (!node) throw new Error(`no node with text ${JSON.stringify(text)}`);
  return node.id;
};

const reconcile = (before: string, after: string, options?: Syntax.ReconcileOptions) => {
  const identity = identifySyntax(before);
  return { identity, next: reconcileSyntax({ source: before, identity }, after, options) };
};

describe("identifySyntax", () => {
  test("identifies nodes and comments in document order with parents", () => {
    const source = `; header
(define (f x)
  ; doubles
  (* x 2)) ; trailing
[1 "two"]`;
    const identity = identifySyntax(source);
    const rows = identity.nodes.map((node) => [
      node.kind,
      textOf(source, node),
      node.parent === null ? null : textOf(source, indexSyntax(identity).node(node.parent)!),
      node.index,
    ]);
    expect(rows).toEqual([
      ["Comment", "; header", null, 0],
      ["List", "(define (f x)\n  ; doubles\n  (* x 2))", null, 1],
      ["Symbol", "define", "(define (f x)\n  ; doubles\n  (* x 2))", 0],
      ["List", "(f x)", "(define (f x)\n  ; doubles\n  (* x 2))", 1],
      ["Symbol", "f", "(f x)", 0],
      ["Symbol", "x", "(f x)", 1],
      ["Comment", "; doubles", "(define (f x)\n  ; doubles\n  (* x 2))", 2],
      ["List", "(* x 2)", "(define (f x)\n  ; doubles\n  (* x 2))", 3],
      ["Symbol", "*", "(* x 2)", 0],
      ["Symbol", "x", "(* x 2)", 1],
      ["Number", "2", "(* x 2)", 2],
      ["Comment", "; trailing", null, 2],
      ["Vector", '[1 "two"]', null, 3],
      ["Number", "1", '[1 "two"]', 0],
      ["String", '"two"', '[1 "two"]', 1],
    ]);
    expect(new Set(identity.nodes.map((node) => node.id)).size).toBe(identity.nodes.length);
    expect(identity.errors).toEqual([]);
  });

  test("keeps comments before a closing delimiter inside the list", () => {
    const source = "(do a\n  ; last\n  )";
    const identity = identifySyntax(source);
    const comment = identity.nodes.find((node) => node.kind === "Comment")!;
    expect(indexSyntax(identity).node(comment.parent!)!.kind).toBe("List");
    expect(comment.index).toBe(2);
  });

  test("identifies reader macros and their forms", () => {
    const source = "`(if ~test nil)";
    const kinds = identifySyntax(source).nodes.map((node) => [node.kind, textOf(source, node)]);
    expect(kinds.slice(0, 3)).toEqual([
      ["ReaderMacro", "`(if ~test nil)"],
      ["List", "(if ~test nil)"],
      ["Symbol", "if"],
    ]);
  });

  test("never throws on malformed input and reports located errors", () => {
    for (const source of ['(f "abc', "(f #x)", "(a))", ")(", "(a [b)", '"""open', "~"]) {
      const identity = identifySyntax(source);
      expect(identity.errors.length, source).toBeGreaterThan(0);
      for (const error of identity.errors) {
        expect(error.span.start).toBeGreaterThanOrEqual(0);
        expect(error.span.end).toBeLessThanOrEqual(source.length);
      }
    }
    const identity = identifySyntax("(f #x) (g 1)");
    expect(identity.nodes.filter((node) => node.parent === null).map((node) => node.kind)).toEqual(
      ["List", "List"],
    );
  });

  test("reports the same parse errors as before lexing recovered", () => {
    expect(() => Reader.tokenize('"abc')).toThrow(/Unterminated string/);
    const parsed = Reader.parse('(f "abc');
    expect(parsed.errors[0]?.message).toMatch(/^Unterminated string/);
  });

  test("anchors assign caller ids and fresh ids avoid them", () => {
    const source = "(a b)";
    const identity = identifySyntax(source, {
      anchors: [
        { id: "row-1", span: { start: 0, end: 5 } },
        { id: "n2", span: { start: 1, end: 2 } },
      ],
    });
    expect(identity.nodes.map((node) => node.id)).toEqual(["row-1", "n2", "n3"]);
    expect(identity.nextId).toBe(4);
  });
});

describe("reconcileSyntax", () => {
  test("an edit inside a form keeps ids of its ancestors and siblings", () => {
    const before = "(define (f x)\n  (* x 2))\n(f 3)";
    const after = "(define (f x)\n  (* x 20))\n(f 3)";
    const { identity, next } = reconcile(before, after);
    for (const text of ["(f 3)", "f", "define", "*"]) {
      expect(idOf(after, next, text === "(f 3)" ? text : text)).toBe(idOf(before, identity, text));
    }
    expect(idOf(after, next, "(define (f x)\n  (* x 20))")).toBe(
      idOf(before, identity, "(define (f x)\n  (* x 2))"),
    );
    expect(idOf(after, next, "20")).toBe(idOf(before, identity, "2", 0));
  });

  test("inserting a form above others keeps their ids", () => {
    const before = "(a 1)\n(b 2)";
    const after = "(z 0)\n(a 1)\n(b 2)";
    const { identity, next } = reconcile(before, after);
    expect(idOf(after, next, "(a 1)")).toBe(idOf(before, identity, "(a 1)"));
    expect(idOf(after, next, "(b 2)")).toBe(idOf(before, identity, "(b 2)"));
    const fresh = idOf(after, next, "(z 0)");
    expect(identity.nodes.map((node) => node.id)).not.toContain(fresh);
  });

  test("typing at the end of a symbol keeps its id", () => {
    const before = "(total revenue)";
    const after = "(total revenues)";
    const { identity, next } = reconcile(before, after);
    expect(idOf(after, next, "revenues")).toBe(idOf(before, identity, "revenue"));
  });

  test("retyping a node in place keeps its id", () => {
    const { identity, next } = reconcile("(f alpha 2)", "(f omega 2)");
    expect(idOf("(f omega 2)", next, "omega")).toBe(idOf("(f alpha 2)", identity, "alpha"));
  });

  test("a subtree moved by cut and paste keeps its ids", () => {
    const before = "(workflow\n  (step a)\n  (step b {:x 1}))";
    const after = "(workflow\n  (step b {:x 1})\n  (step a))";
    const { identity, next } = reconcile(before, after);
    for (const text of ["(step a)", "(step b {:x 1})", "{:x 1}", ":x"]) {
      expect(idOf(after, next, text)).toBe(idOf(before, identity, text));
    }
  });

  test("reformatting keeps ids", () => {
    const before = "(let [a 1\n      b 2]\n  (+ a b))";
    const after = "(let [a 1 b 2] (+ a b))";
    const { identity, next } = reconcile(before, after);
    expect(next.nodes.map((node) => node.id)).toEqual(identity.nodes.map((node) => node.id));
  });

  test("does not guess between identical duplicates", () => {
    const before = "(log x)\n(log x)";
    const after = "(log x)";
    const { identity, next } = reconcile(before, after);
    expect(next.nodes[0]!.id).toBe(identity.nodes[0]!.id);
  });

  test("retires deleted ids and keeps nextId monotone", () => {
    const first = identifySyntax("(a) (b)");
    const second = reconcileSyntax({ source: "(a) (b)", identity: first }, "(a)");
    const third = reconcileSyntax({ source: "(a)", identity: second }, "(a) (c)");
    const removed = first.nodes.filter((node) => !second.nodes.some((n) => n.id === node.id));
    expect(removed.length).toBeGreaterThan(0);
    for (const node of removed) {
      expect(third.nodes.map((n) => n.id)).not.toContain(node.id);
    }
    expect(third.nextId).toBeGreaterThanOrEqual(second.nextId);
    expect(second.nextId).toBeGreaterThanOrEqual(first.nextId);
  });

  test("anchors carry ids and subtrees to new places", () => {
    const before = "(a (b c)) (d)";
    const after = "(a) (d (b c))";
    const identity = identifySyntax(before);
    const bc = idOf(before, identity, "(b c)");
    const next = reconcileSyntax({ source: before, identity }, after, {
      anchors: [{ id: bc, span: { start: 7, end: 12 } }],
    });
    expect(idOf(after, next, "(b c)")).toBe(bc);
    expect(idOf(after, next, "c")).toBe(idOf(before, identity, "c"));
  });

  test("wrapping and raising through a text diff keep the inner node's id", () => {
    const wrapped = reconcile("(x) (a b) (y)", "(x) ((a b)) (y)");
    expect(idOf("(x) ((a b)) (y)", wrapped.next, "(a b)")).toBe(
      idOf("(x) (a b) (y)", wrapped.identity, "(a b)"),
    );
    const raised = reconcile("(x) ((a b)) (y)", "(x) (a b) (y)");
    expect(idOf("(x) (a b) (y)", raised.next, "(a b)")).toBe(
      idOf("(x) ((a b)) (y)", raised.identity, "(a b)"),
    );
  });

  test("explicit anchors win over structure carried by an anchored parent", () => {
    const before = "(do (log x) (log x))";
    const identity = identifySyntax(before);
    const [first, second] = identity.nodes.filter((node) => before.slice(node.span.start, node.span.end) === "(log x)");
    const next = reconcileSyntax({ source: before, identity }, before, {
      anchors: [
        { id: identity.nodes[0]!.id, span: { start: 0, end: 20 } },
        { id: second!.id, span: first!.span },
        { id: first!.id, span: second!.span },
      ],
    });
    expect(next.nodes.find((node) => node.span.start === first!.span.start)?.id).toBe(second!.id);
  });

  test("retired ids are never reused", () => {
    const { identity, next } = reconcile("(f a)", "(f b)", {});
    expect(idOf("(f b)", next, "b")).toBe(idOf("(f a)", identity, "a"));
    const retired = reconcileSyntax({ source: "(f a)", identity }, "(f b)", {
      retired: [idOf("(f a)", identity, "a")],
    });
    expect(retired.nodes.map((node) => node.id)).not.toContain(idOf("(f a)", identity, "a"));
  });

  test("explicit changes take precedence over a text diff", () => {
    // Inserting "(a) " before an identical "(a)" is ambiguous as a text diff.
    const before = "(a)";
    const after = "(a) (a)";
    const identity = identifySyntax(before);
    const original = identity.nodes[0]!.id;
    const appended = reconcileSyntax({ source: before, identity }, after);
    expect(appended.nodes[0]!.id).toBe(original);
    const prepended = reconcileSyntax({ source: before, identity }, after, {
      changes: [{ start: 0, end: 0, text: "(a) " }],
    });
    expect(prepended.nodes.find((node) => node.span.start === 4)!.id).toBe(original);
  });
});

// =============================================================================
// Properties
// =============================================================================

const edit = (source: string) =>
  fc
    .tuple(
      fc.nat({ max: source.length }),
      fc.nat({ max: 6 }),
      fc.constantFrom("", "x", " ", "(q)", "\n", ")", "(", '"'),
    )
    .map(([start, length, text]) => ({
      start,
      end: Math.min(source.length, start + length),
      text,
    }));

describe("reconcileSyntax properties", () => {
  test("ids are unique and fresh ids never reuse retired ones", () => {
    fc.assert(
      fc.property(
        program.chain((source) => fc.tuple(fc.constant(source), edit(source))),
        ([source, change]) => {
          const after = source.slice(0, change.start) + change.text + source.slice(change.end);
          const identity = identifySyntax(source);
          const next = reconcileSyntax({ source, identity }, after);
          const ids = next.nodes.map((node) => node.id);
          expect(new Set(ids).size).toBe(ids.length);
          const old = new Set(identity.nodes.map((node) => node.id));
          for (const node of next.nodes) {
            if (old.has(node.id)) continue;
            expect(Number(node.id.slice(1))).toBeGreaterThanOrEqual(identity.nextId);
          }
          expect(reconcileSyntax({ source, identity }, after)).toEqual(next);
        },
      ),
      { numRuns: 500 },
    );
  });

  test("nodes outside the changed region keep their ids", () => {
    fc.assert(
      fc.property(
        program.chain((source) => fc.tuple(fc.constant(source), edit(source))),
        ([source, change]) => {
          const after = source.slice(0, change.start) + change.text + source.slice(change.end);
          const identity = identifySyntax(source);
          const next = reconcileSyntax({ source, identity }, after, { changes: [change] });
          const shift = change.text.length - (change.end - change.start);
          const index = indexSyntax(next);
          for (const node of identity.nodes) {
            const before = node.span.end < change.start;
            const afterChange = node.span.start > change.end;
            if (!before && !afterChange) continue;
            const delta = afterChange ? shift : 0;
            const moved = index.withSpan(node.span.start + delta, node.span.end + delta);
            // The same text still parses to the same node unless the edit
            // changed how its surroundings read (for example an opened string).
            if (moved === undefined || moved.kind !== node.kind) continue;
            const candidates = next.nodes.filter(
              (candidate) =>
                candidate.span.start === node.span.start + delta &&
                candidate.span.end === node.span.end + delta &&
                candidate.kind === node.kind,
            );
            expect(candidates.map((candidate) => candidate.id)).toContain(node.id);
          }
        },
      ),
      { numRuns: 500 },
    );
  });

  test("identity is unchanged when the source is unchanged", () => {
    fc.assert(
      fc.property(program, (source) => {
        const identity = identifySyntax(source);
        expect(reconcileSyntax({ source, identity }, source)).toEqual(identity);
      }),
    );
  });
});
