/**
 * Review E: identity reconciliation (`identifySyntax` / `reconcileSyntax`).
 *
 * Passing tests pin behaviour that is correct under the objective
 *   "maximize preserved unchanged subtrees; prefer isomorphic subtree matches
 *    over position-only matches; never resurrect ids".
 * `test.fails` entries are confirmed counterexamples, each with a minimal
 * repro, the expected answer, and a one-line root cause.
 */
import { describe, expect, test } from "vitest";
import fc from "fast-check";

import { Syntax } from "../src/index.js";
import { form, program } from "./support/programs.js";
import { runs } from "./support/runs.js";

const { identifySyntax, reconcileSyntax, indexSyntax } = Syntax;
type Identity = Syntax.SyntaxIdentity;

const textOf = (source: string, node: Syntax.SyntaxNode) => source.slice(node.span.start, node.span.end);

const idOf = (source: string, identity: Identity, text: string, nth = 0) => {
  const node = identity.nodes.filter((candidate) => textOf(source, candidate) === text)[nth];
  if (!node) throw new Error(`no node with text ${JSON.stringify(text)}`);
  return node.id;
};

const reconcile = (before: string, after: string, options?: Syntax.ReconcileOptions) => {
  const identity = identifySyntax(before);
  return { identity, next: reconcileSyntax({ source: before, identity }, after, options) };
};

/** Old ids that survive into the new identity. */
const preserved = (identity: Identity, next: Identity) => {
  const old = new Set(identity.nodes.map((node) => node.id));
  return next.nodes.filter((node) => old.has(node.id)).length;
};

const RUNS = { numRuns: runs(600), endOnFailure: false };

/**
 * Renames atoms, comments, and empty containers in a generated program so no
 * two subtrees share a signature. Matching on such programs has no ties.
 */
const uniquify = (source: string) => {
  let counter = 0;
  return source
    .replace(/\(\)|\[\]|\{\}/g, (match) => `${match[0]}e${++counter}${match[1]}`)
    .replace(/lines"""/g, () => `lines${++counter}"""`)
    .replace(
      /(?<![\w"-])(a|b|foo|bar-baz|1|42|:k|:v|"s"|true|; note|; why)(?![\w"-])/g,
      (match) =>
        match.startsWith(";")
          ? `${match}${++counter}`
          : match.startsWith('"')
            ? `"s${++counter}"`
            : /^\d/.test(match)
              ? `${++counter}`
              : `${match}${++counter}`,
    );
};
const uniqueProgram = program.map(uniquify);

/** Lists with a duplicated child, `(f X X ...)`, to provoke signature ties. */
const dupProgram = fc
  .array(
    fc.oneof(
      fc
        .tuple(fc.constantFrom("f", "g"), form, fc.array(form, { maxLength: 2 }))
        .map(([head, x, rest]) => `(${head} ${x} ${x} ${rest.join(" ")})`),
      form,
    ),
    { minLength: 1, maxLength: 3 },
  )
  .map((forms) => forms.join("\n"));

type Op = "wrap" | "raise" | "splice";

/** Applies a structural operation to one node as a whole-text replacement. */
const structuralEdit = (source: string, identity: Identity, op: Op, pick: number) => {
  const index = indexSyntax(identity);
  const candidates = identity.nodes.filter((node) =>
    op === "wrap"
      ? node.kind !== "Comment"
      : op === "splice"
        ? node.kind === "List" || node.kind === "Vector"
        : node.kind !== "Comment" && node.parent !== null && index.node(node.parent)!.kind !== "ReaderMacro",
  );
  if (candidates.length === 0) return undefined;
  const node = candidates[pick % candidates.length]!;
  const text = textOf(source, node);
  if (op === "wrap") {
    return { node, removed: [] as string[], after: `${source.slice(0, node.span.start)}(${text})${source.slice(node.span.end)}` };
  }
  if (op === "splice") {
    return { node, removed: [node.id], after: `${source.slice(0, node.span.start)} ${text.slice(1, -1)} ${source.slice(node.span.end)}` };
  }
  const parent = index.node(node.parent!)!;
  const kept = new Set(index.subtree(node.id).map((n) => n.id));
  return {
    node,
    removed: index.subtree(parent.id).filter((n) => !kept.has(n.id)).map((n) => n.id),
    after: source.slice(0, parent.span.start) + text + source.slice(parent.span.end),
  };
};

/**
 * Wrap, raise, and splice never retype an atom, so an atom's id must land only
 * on an atom with the same text, and a reader macro's only on a reader macro.
 */
const expectAtomsFaithful = (before: string, identity: Identity, after: string, next: Identity, label: string) => {
  const old = indexSyntax(identity);
  const atom = (kind: string) => !["List", "Vector", "Map", "Set", "ReaderMacro"].includes(kind);
  for (const node of next.nodes) {
    const was = old.node(node.id);
    if (!was) continue;
    if (atom(node.kind) || atom(was.kind)) {
      expect(`${node.kind} ${textOf(after, node)}`, label).toBe(`${was.kind} ${textOf(before, was)}`);
    } else if (node.kind === "ReaderMacro" || was.kind === "ReaderMacro") {
      expect(node.kind, label).toBe(was.kind);
    }
  }
};

// =============================================================================
// The two known bugs and the patch
// =============================================================================

describe("patched: wrap/raise without changes (#16) and anchored-parent follow (#17)", () => {
  test("#16 wrap: inner keeps its id and subtree, wrapper is fresh", () => {
    const before = "(x) (a b) (y)";
    const after = "(x) ((a b)) (y)";
    const { identity, next } = reconcile(before, after);
    expect(idOf(after, next, "(a b)")).toBe(idOf(before, identity, "(a b)"));
    expect(idOf(after, next, "a")).toBe(idOf(before, identity, "a"));
    expect(identity.nodes.map((node) => node.id)).not.toContain(idOf(after, next, "((a b))"));
  });

  test.each([
    ["at document start", "(a b) (z)", "((a b)) (z)", "(a b)"],
    ["at document end", "(z) (a b)", "(z) ((a b))", "(a b)"],
    ["the whole document", "(a b)", "((a b))", "(a b)"],
    ["an atom", "(f x)", "(f (x))", "x"],
    ["a top-level atom", "x", "(x)", "x"],
    ["a node with a duplicate elsewhere", "(a b) (a b)", "((a b)) (a b)", "(a b)"],
    ["a node with a duplicate after it", "(p (a b)) (q (a b))", "(p ((a b))) (q (a b))", "(a b)"],
    ["with a head", "(a b)", "(do (a b))", "(a b)", 2],
    ["in a reader macro", "'x", "'(x)", "x"],
  ] as [string, string, string, string, number?][])("#16 wrap %s keeps every old id and adds a fresh wrapper", (_, before, after, wrapped, added = 1) => {
    const { identity, next } = reconcile(before, after);
    expect(preserved(identity, next)).toBe(identity.nodes.length);
    expect(next.nodes.length).toBe(identity.nodes.length + added);
    expect(idOf(after, next, wrapped)).toBe(idOf(before, identity, wrapped));
  });

  test("#16 raise: the raised node keeps its id; the removed parent's id is gone", () => {
    const before = "(x) ((a b)) (y)";
    const after = "(x) (a b) (y)";
    const { identity, next } = reconcile(before, after);
    expect(idOf(after, next, "(a b)")).toBe(idOf(before, identity, "(a b)"));
    expect(next.nodes.map((node) => node.id)).not.toContain(idOf(before, identity, "((a b))"));
    const raised = reconcile("(do (a b))", "(a b)");
    expect(idOf("(a b)", raised.next, "(a b)")).toBe(idOf("(do (a b))", raised.identity, "(a b)"));
  });

  test("#16 with explicit changes, positions put the old node inside the wrapper", () => {
    const before = "(x) (a b) (y)";
    const after = "(x) ((a b)) (y)";
    const { identity, next } = reconcile(before, after, {
      changes: [
        { start: 4, end: 4, text: "(" },
        { start: 9, end: 9, text: ")" },
      ],
    });
    expect(idOf(after, next, "(a b)")).toBe(idOf(before, identity, "(a b)"));
    expect(identity.nodes.map((node) => node.id)).not.toContain(idOf(after, next, "((a b))"));
  });

  test("#17 explicit anchors win over the structure an anchored parent carries", () => {
    const before = "(do (log x) (log y))";
    const identity = identifySyntax(before);
    const first = identity.nodes.find((node) => textOf(before, node) === "(log x)")!;
    const second = identity.nodes.find((node) => textOf(before, node) === "(log y)")!;
    // Anchors listed child-first and parent-first give the same answer.
    for (const order of [0, 1]) {
      const anchors = [
        { id: second.id, span: first.span },
        { id: identity.nodes[0]!.id, span: identity.nodes[0]!.span },
      ];
      const next = reconcileSyntax({ source: before, identity }, before, {
        anchors: order ? anchors.reverse() : anchors,
      });
      expect(next.nodes.find((node) => node.span.start === first.span.start)!.id).toBe(second.id);
      expect(new Set(next.nodes.map((node) => node.id)).size).toBe(next.nodes.length);
    }
  });

  test("`retired` keeps a deleted id away from a same-slot or retyped node", () => {
    const { identity } = reconcile("(f a)", "(f a)");
    const a = idOf("(f a)", identity, "a");
    const next = reconcileSyntax({ source: "(f a)", identity }, "(f b)", { retired: [a] });
    expect(next.nodes.map((node) => node.id)).not.toContain(a);
    // A retired id is not carried by signature either.
    const moved = reconcileSyntax({ source: "(f a)", identity }, "(g) (f a)", { retired: [a] });
    expect(moved.nodes.map((node) => node.id)).not.toContain(a);
  });
});

// =============================================================================
// Pinned behaviour
// =============================================================================

describe("pinned behaviour", () => {
  test("braces flipping between set and map keep their id", () => {
    for (const [before, after] of [
      ["{:a 1}", "{:a}"],
      ["{a}", "{a b}"],
      ["{:a 1 :b 2}", "{:a 1 :b}"],
    ] as const) {
      const { identity, next } = reconcile(before, after);
      expect(next.nodes[0]!.id, `${before} -> ${after}`).toBe(identity.nodes[0]!.id);
    }
  });

  test("a kind change at the same span gives a fresh id but keeps the children", () => {
    const vector = reconcile("[a]", "(a)");
    expect(vector.next.nodes[0]!.id).not.toBe(vector.identity.nodes[0]!.id);
    expect(idOf("(a)", vector.next, "a")).toBe(idOf("[a]", vector.identity, "a"));
    const number = reconcile("(f x)", "(f 1)");
    expect(number.identity.nodes.map((node) => node.id)).not.toContain(idOf("(f 1)", number.next, "1"));
  });

  test("adding or removing a reader macro keeps the inner form", () => {
    const quoted = reconcile("(f x)", "(f 'x)");
    expect(idOf("(f 'x)", quoted.next, "x")).toBe(idOf("(f x)", quoted.identity, "x"));
    const unquoted = reconcile("(f 'x)", "(f x)");
    expect(idOf("(f x)", unquoted.next, "x")).toBe(idOf("(f 'x)", unquoted.identity, "x"));
    expect(unquoted.next.nodes.map((node) => node.id)).not.toContain(idOf("(f 'x)", unquoted.identity, "'x"));
  });

  test("ids never cross between a comment and code", () => {
    const { identity, next } = reconcile("(f ; x\n y)", "(f x\n y)");
    expect(identity.nodes.map((node) => node.id)).not.toContain(idOf("(f x\n y)", next, "x"));
    const moved = reconcile("(f ; c\n x)", "(f x\n ; c\n)");
    expect(idOf("(f x\n ; c\n)", moved.next, "; c")).toBe(idOf("(f ; c\n x)", moved.identity, "; c"));
  });

  test("a diff boundary inside an atom keeps the atom", () => {
    const { identity, next } = reconcile("(foo)", "(fob)");
    expect(next.nodes.map((node) => node.id)).toEqual(identity.nodes.map((node) => node.id));
  });

  test("an anchor naming a live id moves it; the old place gets a fresh id", () => {
    const before = "(a) (b)";
    const after = "(a) (b) (c)";
    const { identity, next } = reconcile(before, after, {
      anchors: [{ id: "n1", span: { start: 8, end: 11 } }],
    });
    expect(idOf(before, identity, "(a)")).toBe("n1");
    expect(idOf(after, next, "(c)")).toBe("n1");
    expect(identity.nodes.map((node) => node.id)).not.toContain(idOf(after, next, "(a)"));
    expect(idOf(after, next, "a")).toBe(idOf(before, identity, "a"));
  });

  test("two anchors on one span: the first wins and ids stay unique", () => {
    const before = "(a) (b)";
    const { identity, next } = reconcile(before, before, {
      anchors: [
        { id: "n3", span: { start: 0, end: 3 } },
        { id: "n1", span: { start: 0, end: 3 } },
      ],
    });
    expect(next.nodes[0]!.id).toBe(idOf(before, identity, "(b)"));
    expect(new Set(next.nodes.map((node) => node.id)).size).toBe(next.nodes.length);
  });

  test("an anchor whose span matches nothing is ignored", () => {
    const before = "(a) (b)";
    const { identity, next } = reconcile(before, before, { anchors: [{ id: "n3", span: { start: 1, end: 3 } }] });
    expect(next).toEqual(identity);
  });

  test("an anchor id beyond nextId (created mid-script) advances nextId", () => {
    const { next } = reconcile("(a)", "(a) (b)", { anchors: [{ id: "n9", span: { start: 4, end: 7 } }] });
    expect(idOf("(a) (b)", next, "(b)")).toBe("n9");
    expect(idOf("(a) (b)", next, "b")).toBe("n10");
    expect(next.nextId).toBe(11);
  });

  test("changes that contradict the texts do not break the invariants", () => {
    // An empty change list for a swap: the signature pass still recovers both.
    const swapped = reconcile("(x) (y)", "(y) (x)", { changes: [] });
    expect(idOf("(y) (x)", swapped.next, "(x)")).toBe(idOf("(x) (y)", swapped.identity, "(x)"));
    fc.assert(
      fc.property(
        program,
        program,
        fc.array(fc.record({ start: fc.integer({ min: -5, max: 80 }), end: fc.integer({ min: -5, max: 80 }), text: fc.string({ maxLength: 4 }) }), { maxLength: 3 }),
        (before, after, changes) => {
          const identity = identifySyntax(before);
          const next = reconcileSyntax({ source: before, identity }, after, { changes });
          const ids = next.nodes.map((node) => node.id);
          expect(new Set(ids).size).toBe(ids.length);
          expect(next.nextId).toBeGreaterThanOrEqual(identity.nextId);
          expect(reconcileSyntax({ source: before, identity }, after, { changes })).toEqual(next);
        },
      ),
      RUNS,
    );
  });
});

// =============================================================================
// Properties over edit sequences and structural edits
// =============================================================================

const TEXTS = ["", "x", " ", "(q)", "\n", ")", "(", '"', "(a)", "a", "'"];

describe("properties", () => {
  test("2-5 step edit sequences: unique ids, monotone nextId, no resurrection, deterministic", () => {
    fc.assert(
      fc.property(
        program,
        fc.array(fc.tuple(fc.nat(), fc.nat({ max: 6 }), fc.nat()), { minLength: 2, maxLength: 5 }),
        fc.boolean(),
        (source, edits, useChanges) => {
          let identity = identifySyntax(source);
          let current = source;
          const ever = new Set(identity.nodes.map((node) => node.id));
          for (const [at, length, pick] of edits) {
            const start = at % (current.length + 1);
            const change = { start, end: Math.min(current.length, start + length), text: TEXTS[pick % TEXTS.length]! };
            const after = current.slice(0, change.start) + change.text + current.slice(change.end);
            const options = useChanges ? { changes: [change] } : {};
            const next = reconcileSyntax({ source: current, identity }, after, options);
            expect(reconcileSyntax({ source: current, identity }, after, options)).toEqual(next);
            const ids = next.nodes.map((node) => node.id);
            expect(new Set(ids).size).toBe(ids.length);
            expect(next.nextId).toBeGreaterThanOrEqual(identity.nextId);
            const live = new Set(identity.nodes.map((node) => node.id));
            for (const id of ids) {
              if (!live.has(id)) {
                expect(ever.has(id), `resurrected ${id}`).toBe(false);
                expect(Number(id.slice(1))).toBeGreaterThanOrEqual(identity.nextId);
              }
              expect(Number(id.slice(1))).toBeLessThan(next.nextId);
              ever.add(id);
            }
            identity = next;
            current = after;
          }
        },
      ),
      RUNS,
    );
  });

  // With no signature ties, whole-text wrap, raise, splice, and moves of a
  // top-level form preserve exactly the ids the operation did not remove.
  test.each(["wrap", "raise", "splice"] as const)("%s on tie-free programs preserves every surviving id", (op) => {
    fc.assert(
      fc.property(uniqueProgram, fc.nat(), (source, pick) => {
        const identity = identifySyntax(source);
        fc.pre(identity.errors.length === 0);
        const edit = structuralEdit(source, identity, op, pick);
        fc.pre(edit !== undefined && identifySyntax(edit.after).errors.length === 0);
        const next = reconcileSyntax({ source, identity }, edit!.after);
        const label = `${JSON.stringify(source)} ${op} ${JSON.stringify(textOf(source, edit!.node))}`;
        expect(preserved(identity, next), label).toBe(identity.nodes.length - edit!.removed.length);
        expectAtomsFaithful(source, identity, edit!.after, next, label);
      }),
      RUNS,
    );
  });

  const moveTopLevel = (forms: string[], from: number, to: number) => {
    const rest = forms.filter((_, index) => index !== from);
    rest.splice(to, 0, forms[from]!);
    return rest.join("\n");
  };
  const moveProperty = (unique: boolean) =>
    fc.property(fc.array(form, { minLength: 2, maxLength: 5 }), fc.nat(), fc.nat(), (raw, i, j) => {
      const forms = unique ? uniquify(raw.join("\u0000")).split("\u0000") : raw;
      const from = i % forms.length;
      const to = j % forms.length;
      fc.pre(from !== to);
      const source = forms.join("\n");
      const identity = identifySyntax(source);
      fc.pre(identity.errors.length === 0);
      const after = moveTopLevel(forms, from, to);
      const next = reconcileSyntax({ source, identity }, after);
      expect(preserved(identity, next), `${JSON.stringify(source)} -> ${JSON.stringify(after)}`).toBe(identity.nodes.length);
    });

  test("moving a top-level form on tie-free programs keeps every id", () => {
    fc.assert(moveProperty(true), RUNS);
  });

  test.each(["wrap", "splice"] as const)("%s with duplicated children keeps atoms faithful", (op) => {
    fc.assert(
      fc.property(dupProgram, fc.nat(), (source, pick) => {
        const identity = identifySyntax(source);
        fc.pre(identity.errors.length === 0);
        const edit = structuralEdit(source, identity, op, pick);
        fc.pre(edit !== undefined && identifySyntax(edit.after).errors.length === 0);
        const next = reconcileSyntax({ source, identity }, edit!.after);
        expectAtomsFaithful(source, identity, edit!.after, next, `${JSON.stringify(source)} ${op}`);
      }),
      RUNS,
    );
  });

  // Shrunk counterexample: "a\na\na\n42" -> "42\na\na\na" preserves 3 of 4
  // ids (the first `a` loses its id although no `a` was touched).
  test.fails("moving a top-level form across duplicates keeps every id", () => {
    fc.assert(moveProperty(false), { ...RUNS, examples: [[["a", "a", "a", "42"], 3, 0]] });
  });

  // Shrunk counterexample: "(f (a) (a) )" raise the first "(a)" -> "(a)":
  // `a` takes the id of `f`.
  test.fails("raise with duplicated children keeps atoms faithful", () => {
    fc.assert(
      fc.property(dupProgram, fc.nat(), (source, pick) => {
        const identity = identifySyntax(source);
        fc.pre(identity.errors.length === 0);
        const edit = structuralEdit(source, identity, "raise", pick);
        fc.pre(edit !== undefined && identifySyntax(edit.after).errors.length === 0);
        const next = reconcileSyntax({ source, identity }, edit!.after);
        expectAtomsFaithful(source, identity, edit!.after, next, `${JSON.stringify(source)} raise`);
      }),
      { ...RUNS, examples: [["(f (a) (a) )", 1]] },
    );
  });

  // Counterexample: "(a) (b)" -> "(a)" retires n3/n4; "(a)" -> "(a) (c)" with
  // an anchor naming n3 gives "(c)" the retired id n3.
  test.fails("anchors never bring back an id retired in an earlier step", () => {
    fc.assert(
      fc.property(program, fc.nat(), fc.nat(), (source, cut, pickId) => {
        const first = identifySyntax(source);
        const top = first.nodes.filter((node) => node.parent === null);
        fc.pre(top.length > 1);
        const victim = top[cut % top.length]!;
        const middle = source.slice(0, victim.span.start) + source.slice(victim.span.end);
        const second = reconcileSyntax({ source, identity: first }, middle);
        const live = new Set(second.nodes.map((node) => node.id));
        const dropped = first.nodes.filter((node) => !live.has(node.id)).map((node) => node.id);
        fc.pre(dropped.length > 0);
        const after = `${middle}\n(c)`;
        const target = identifySyntax(after).nodes.filter((node) => node.parent === null).at(-1)!;
        const id = dropped[pickId % dropped.length]!;
        const third = reconcileSyntax({ source: middle, identity: second }, after, {
          anchors: [{ id, span: target.span }],
        });
        expect(third.nodes.map((node) => node.id)).not.toContain(id);
      }),
      { ...RUNS, examples: [["(a) (b)", 1, 0]] },
    );
  });
});

// =============================================================================
// Confirmed siblings
// =============================================================================

describe("siblings", () => {
  // Root cause: pass 3 refuses ambiguous signatures, so duplicates fall to the
  // edited-in-place pair (old list -> wrapper span) and same-slot by index.
  test.fails("wrapping two duplicates at once keeps the wrapped ids (no changes)", () => {
    const before = "(a) (a)";
    const after = "((a) (a))";
    const { identity, next } = reconcile(before, after);
    // Actual: the wrapper takes the first (a)'s id; both inner (a) and `a` are fresh.
    expect(idOf(after, next, "(a)", 0)).toBe(idOf(before, identity, "(a)", 0));
    expect(idOf(after, next, "(a)", 1)).toBe(idOf(before, identity, "(a)", 1));
    expect(identity.nodes.map((node) => node.id)).not.toContain(idOf(after, next, after));
  });

  test.fails("wrapping each of two duplicates keeps the wrapped ids (no changes)", () => {
    const before = "(a b) (a b)";
    const after = "((a b)) ((a b))";
    const { identity, next } = reconcile(before, after);
    // Actual: each wrapper takes an inner id; the inner lists and atoms are fresh.
    expect(idOf(after, next, "(a b)", 0)).toBe(idOf(before, identity, "(a b)", 0));
    expect(idOf(after, next, "(a b)", 1)).toBe(idOf(before, identity, "(a b)", 1));
  });

  test.fails("raising each of two duplicates keeps the raised ids (no changes)", () => {
    const before = "((a b)) ((a b))";
    const after = "(a b) (a b)";
    const { identity, next } = reconcile(before, after);
    // Actual: the raised lists take the removed wrappers' ids; a and b are fresh.
    expect(idOf(after, next, "(a b)", 0)).toBe(idOf(before, identity, "(a b)", 0));
    expect(preserved(identity, next)).toBe(6);
  });

  // Root cause: same as above, plus same-slot gives an atom to a different atom.
  test.fails("raising one of two duplicates never gives `f`'s id to `a`", () => {
    const before = "(f (a) (a))";
    const after = "(a)";
    const { identity, next } = reconcile(before, after);
    // Actual: (a) <- (f (a) (a)) by position; a <- f by same slot.
    expect([idOf(before, identity, "a", 0), idOf(before, identity, "a", 1)]).toContain(idOf(after, next, "a"));
    expect([idOf(before, identity, "(a)", 0), idOf(before, identity, "(a)", 1)]).toContain(idOf(after, next, "(a)"));
  });

  // Root cause: same-slot pairs by child index after a deletion shifted the
  // indices, and ties stop the signature pass from claiming the (q)s first.
  test.fails("delete one child and append another next to duplicates", () => {
    const before = "(do (p) (q) (q))";
    const after = "(do (q) (q) (r))";
    const { identity, next } = reconcile(before, after);
    // Actual: (q)#0 <- (p), q <- p, (r) <- (q)#1.
    expect(idOf(after, next, "(q)", 0)).toBe(idOf(before, identity, "(q)", 0));
    expect(idOf(after, next, "(q)", 1)).toBe(idOf(before, identity, "(q)", 1));
    expect(identity.nodes.map((node) => node.id)).not.toContain(idOf(after, next, "(r)"));
  });

  test.fails("moving a form across untouched duplicates keeps them", () => {
    const before = "a\na\na\n42";
    const after = "42\na\na\na";
    const { identity, next } = reconcile(before, after);
    // Actual: the first `a` loses its id; the others shift by one.
    expect(next.nodes.filter((node) => node.kind === "Symbol").map((node) => node.id)).toEqual(
      identity.nodes.filter((node) => node.kind === "Symbol").map((node) => node.id),
    );
  });

  // Root cause: the #16 patch defers edited-in-place pairs behind the
  // signature pass even when explicit `changes` make positions unambiguous.
  test.fails("explicit changes: a retyped name keeps its id when the old name is inserted elsewhere", () => {
    const before = "(define x 1) (foo)";
    const after = "(define y 1) (foo x)";
    const { identity, next } = reconcile(before, after, {
      changes: [
        { start: 8, end: 9, text: "y" },
        { start: 17, end: 17, text: " x" },
      ],
    });
    // Actual: the inserted `x` takes the id; `y` is fresh.
    expect(idOf(after, next, "y")).toBe(idOf(before, identity, "x"));
  });

  test.fails("explicit changes: inserting a copy inside a form keeps the outer id", () => {
    const before = "(do)";
    const after = "(do (do))";
    const { identity, next } = reconcile(before, after, { changes: [{ start: 3, end: 3, text: " (do)" }] });
    // Actual: the inserted (do) takes the id, the outer list is fresh while
    // its head `do` keeps its own id under a fresh parent.
    expect(next.nodes[0]!.id).toBe(identity.nodes[0]!.id);
  });

  test.fails("explicit changes: deleting a look-alike child keeps the parent's id", () => {
    const before = "(a (a))";
    const after = "(a)";
    const { identity, next } = reconcile(before, after, { changes: [{ start: 2, end: 6, text: "" }] });
    // Actual: (a) takes the deleted inner list's id; `a` keeps the outer's head id.
    expect(next.nodes[0]!.id).toBe(identity.nodes[0]!.id);
  });

  test.fails("explicit changes: a retyped number keeps its id when an equal number is deleted", () => {
    const before = "(f 1) 2";
    const after = "(f 2)";
    const { identity, next } = reconcile(before, after, {
      changes: [
        { start: 3, end: 4, text: "2" },
        { start: 5, end: 7, text: "" },
      ],
    });
    expect(idOf(after, next, "2")).toBe(idOf(before, identity, "1"));
  });

  // Root cause: the signature pass needs identical tokens, so a wrap plus an
  // edit falls back to the position pair (old list -> wrapper).
  test.fails("wrap plus an edit inside keeps the inner list's id (no changes)", () => {
    const before = "(a b)";
    const after = "((a c))";
    const { identity, next } = reconcile(before, after);
    // Actual: wrapper <- (a b); inner (a c) and c fresh.
    expect(idOf(after, next, "(a c)")).toBe(idOf(before, identity, "(a b)"));
  });

  // Root cause: applyAnchors checks neither `retired` nor whether a
  // prefix-generated id below nextId is absent from the previous identity.
  test.fails("an anchor naming an id retired in an earlier step is refused", () => {
    const first = identifySyntax("(a) (b)");
    const second = reconcileSyntax({ source: "(a) (b)", identity: first }, "(a)");
    expect(second.nodes.map((node) => node.id)).not.toContain("n3");
    const third = reconcileSyntax({ source: "(a)", identity: second }, "(a) (c)", {
      anchors: [{ id: "n3", span: { start: 4, end: 7 } }],
    });
    expect(third.nodes.map((node) => node.id)).not.toContain("n3");
  });

  test.fails("an anchor naming an id in `retired` is refused", () => {
    const { identity, next } = reconcile("(f a)", "(f b)", {
      retired: ["n3"],
      anchors: [{ id: "n3", span: { start: 3, end: 4 } }],
    });
    expect(idOf("(f a)", identity, "a")).toBe("n3");
    expect(next.nodes.map((node) => node.id)).not.toContain("n3");
  });
});
