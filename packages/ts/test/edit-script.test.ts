import { describe, expect, test } from "vitest";
import fc from "fast-check";

import { Editor, Syntax } from "../src/index.js";
import { program } from "./support/programs.js";
import { runs } from "./support/runs.js";

const source = `(define tax-rate 0.08)
(define (invoice-total revenue)
  ; Revenue plus tax.
  (let [tax (* revenue tax-rate)]
    (+ revenue tax)))
(workflow onboarding
  (sequence
    background-check
    collect-i9) ; legal
  activate)`;

const setup = (text = source) => {
  const identity = Syntax.identifySyntax(text);
  const id = (snippet: string, nth = 0) => {
    const node = identity.nodes.filter(
      (candidate) => text.slice(candidate.span.start, candidate.span.end) === snippet,
    )[nth];
    if (!node) throw new Error(`no node ${snippet}`);
    return node.id;
  };
  const apply = (...ops: unknown[]) =>
    Editor.applyEditScript({ source: text, identity, script: { version: 1, ops } });
  return { identity, id, apply };
};

const ok = (result: Editor.ApplyEditScriptResult) => {
  if (!result.ok) throw new Error(JSON.stringify(result.errors));
  return result;
};

const textOf = (result: { source: string; identity: Syntax.SyntaxIdentity }, id: string) => {
  const node = result.identity.nodes.find((candidate) => candidate.id === id);
  return node ? result.source.slice(node.span.start, node.span.end) : undefined;
};

const SEQUENCE = "(sequence\n    background-check\n    collect-i9)";

describe("edit script schema", () => {
  test("decodes scripts and reports malformed ones", () => {
    expect(Editor.decodeEditScript({ version: 1, ops: [{ op: "delete", target: "n1" }] })).toEqual(
      { ok: true, script: { version: 1, ops: [{ op: "delete", target: "n1" }] } },
    );
    for (const script of [
      { version: 2, ops: [] },
      { version: 1, ops: [{ op: "explode", target: "n1" }] },
      { version: 1, ops: [{ op: "wrap", targets: [], head: "do" }] },
      { version: 1, ops: [{ op: "insert", at: { parent: null, index: -1 }, text: "x" }] },
      { version: 1, ops: [{ op: "delete", target: "n1", extra: true }] },
    ]) {
      const decoded = Editor.decodeEditScript(script);
      expect(decoded.ok, JSON.stringify(script)).toBe(false);
      if (!decoded.ok) expect(decoded.errors[0]).toMatchObject({ op: -1, code: "edit-script/invalid" });
    }
  });

  test("exports the contract as JSON Schema", () => {
    const document = Editor.editScriptJsonSchema() as {
      dialect: string;
      definitions: Record<string, { anyOf?: { properties: { op: { enum: string[] } } }[] }>;
    };
    expect(document.dialect).toBe("draft-2020-12");
    const ops = document.definitions["EditOp"]!.anyOf!.map((entry) => entry.properties.op.enum[0]);
    expect(ops).toEqual([
      "replace",
      "insert",
      "delete",
      "wrap",
      "splice",
      "unwrap",
      "raise",
      "move",
      "rename",
      "extract",
    ]);
  });

  test("describes nodes with the handles a script uses", () => {
    const { identity, id } = setup();
    const [description] = Editor.describeNodes(source, identity, [id("collect-i9"), "missing"]);
    expect(description).toMatchObject({
      kind: "Symbol",
      text: "collect-i9",
      parent: id(SEQUENCE),
      path: [id(source.slice(source.indexOf("(workflow"))), id(SEQUENCE)],
    });
    expect(description?.topLevel.text.startsWith("(workflow onboarding")).toBe(true);
    expect(Editor.describeNodes(source, identity, [id(SEQUENCE)])[0]?.head).toBe("sequence");
  });
});

describe("applyEditScript", () => {
  test("wraps siblings and keeps their ids", () => {
    const { id, apply } = setup();
    const result = ok(
      apply({ op: "wrap", targets: [id("background-check"), id("collect-i9")], head: "parallel" }),
    );
    expect(result.source).toContain(
      "  (sequence\n    (parallel\n      background-check\n      collect-i9)) ; legal\n",
    );
    expect(textOf(result, id("background-check"))).toBe("background-check");
    expect(result.changes.moved).toEqual([id("background-check"), id("collect-i9")]);
    expect(result.forms.map((form) => form.id)).toEqual([id(source.slice(source.indexOf("(workflow")))]);
  });

  test("wraps a single-line selection inline", () => {
    const { id, apply } = setup("(f a b)");
    expect(ok(apply({ op: "wrap", targets: [id("a")], head: "inc" })).source).toBe("(f (inc a) b)");
    expect(ok(apply({ op: "wrap", targets: [id("a"), id("b")], head: "" })).source).toBe("(f (a b))");
  });

  test("unwraps and splices lists", () => {
    const { id, apply } = setup();
    const unwrapped = ok(apply({ op: "unwrap", target: id(SEQUENCE) }));
    expect(unwrapped.source).toContain(
      "(workflow onboarding\n  background-check\n  collect-i9 ; legal\n  activate)",
    );
    expect(unwrapped.changes.removed).toHaveLength(2);
    const spliced = ok(apply({ op: "splice", target: id("(+ revenue tax)") }));
    expect(spliced.source).toContain("(let [tax (* revenue tax-rate)]\n    + revenue tax))");
  });

  test("raises a node over its parent", () => {
    const { id, apply } = setup();
    const result = ok(apply({ op: "raise", target: id("(+ revenue tax)") }));
    expect(result.source).toContain("(define (invoice-total revenue)\n  ; Revenue plus tax.\n  (+ revenue tax))");
    expect(textOf(result, id("(+ revenue tax)"))).toBe("(+ revenue tax)");
  });

  test("moves a node and keeps its id", () => {
    const { id, apply } = setup();
    const result = ok(apply({ op: "move", target: id("collect-i9"), to: { before: id("background-check") } }));
    expect(result.source).toContain("(sequence\n    collect-i9\n    background-check) ; legal");
    expect(textOf(result, id("collect-i9"))).toBe("collect-i9");
    const out = ok(apply({ op: "move", target: id("activate"), to: { parent: id(SEQUENCE), index: 1 } }));
    expect(out.source).toContain("(sequence\n    activate\n    background-check");
    expect(out.changes.moved).toEqual([id("activate")]);
    expect(
      apply({ op: "move", target: id(SEQUENCE), to: { parent: id(SEQUENCE) } }),
    ).toMatchObject({ ok: false, errors: [{ code: "edit/move-into-self" }] });
  });

  test("inserts and deletes with surrounding layout", () => {
    const { id, apply } = setup();
    expect(
      ok(apply({ op: "insert", at: { after: id("background-check") }, text: "(verify-identity)" })).source,
    ).toContain("    background-check\n    (verify-identity)\n    collect-i9) ; legal");
    expect(ok(apply({ op: "insert", at: { parent: null }, text: "(invoice-total 100)" })).source).toBe(
      `${source}\n(invoice-total 100)`,
    );
    expect(ok(apply({ op: "insert", at: { parent: null, index: 0 }, text: "; header" })).source).toBe(
      `; header\n${source}`,
    );
    expect(ok(apply({ op: "delete", target: id("collect-i9") })).source).toContain(
      "(sequence\n    background-check) ; legal",
    );
    expect(ok(apply({ op: "delete", target: id("; Revenue plus tax.") })).source).toContain(
      "(define (invoice-total revenue)\n  (let",
    );
    const empty = setup("(f [])");
    expect(ok(empty.apply({ op: "insert", at: { parent: empty.id("[]") }, text: "x" })).source).toBe(
      "(f [x])",
    );
  });

  test("replaces a node, keeping its id when the kind is unchanged", () => {
    const { id, apply } = setup();
    const result = ok(apply({ op: "replace", target: id("(* revenue tax-rate)"), text: "(* revenue\n   tax-rate)" }));
    expect(result.source).toContain("(let [tax (* revenue\n               tax-rate)]");
    expect(textOf(result, id("(* revenue tax-rate)"))).toBe("(* revenue\n               tax-rate)");
    expect(apply({ op: "replace", target: id("activate"), text: "(f" })).toMatchObject({
      ok: false,
      errors: [{ op: 0, code: "edit/unreadable-text" }],
    });
  });

  test("renames bindings and their references, refusing captures", () => {
    const { id, apply } = setup();
    const renamed = ok(apply({ op: "rename", target: id("tax-rate", 1), to: "sales-tax" }));
    expect(renamed.source).toContain("(define sales-tax 0.08)");
    expect(renamed.source).toContain("(* revenue sales-tax)");
    expect(renamed.changes.edited).toContain(id("tax-rate"));
    const local = ok(apply({ op: "rename", target: id("tax"), to: "levy" }));
    expect(local.source).toContain("(let [levy (* revenue tax-rate)]\n    (+ revenue levy))");
    expect(apply({ op: "rename", target: id("tax"), to: "revenue" })).toMatchObject({
      ok: false,
      errors: [{ code: "edit/capture" }],
    });
    expect(apply({ op: "rename", target: id("tax-rate"), to: "invoice-total" })).toMatchObject({
      ok: false,
      errors: [{ code: "edit/name-taken" }],
    });
    expect(apply({ op: "rename", target: id("activate"), to: "go" })).toMatchObject({
      ok: false,
      errors: [{ code: "edit/not-a-binding" }],
    });
  });

  test("extracts a form with its free locals as parameters", () => {
    const { id, apply } = setup();
    const result = ok(apply({ op: "extract", target: id("(+ revenue tax)"), name: "with-tax" }));
    expect(result.source.startsWith(
      "(define tax-rate 0.08)\n(define (with-tax revenue tax)\n  (+ revenue tax))\n(define (invoice-total revenue)",
    )).toBe(true);
    expect(result.source).toContain("(let [tax (* revenue tax-rate)]\n    (with-tax revenue tax)))");
    expect(textOf(result, id("(+ revenue tax)"))).toBe("(+ revenue tax)");
    expect(apply({ op: "extract", target: id("activate"), name: "tax-rate" })).toMatchObject({
      ok: false,
      errors: [{ code: "edit/name-taken" }],
    });
  });

  test("applies operations in order against base ids, atomically", () => {
    const { id, apply } = setup();
    const result = ok(
      apply(
        { op: "wrap", targets: [id("background-check")], head: "retry 3" },
        { op: "move", target: id("activate"), to: { after: id("background-check") } },
      ),
    );
    expect(result.source).toContain(
      "(sequence\n    (retry 3 background-check activate)\n    collect-i9) ; legal\n  )",
    );
    const failed = apply({ op: "delete", target: id("activate") }, { op: "delete", target: id("activate") });
    expect(failed).toMatchObject({ ok: false, errors: [{ op: 1, code: "edit/unknown-node" }] });
  });
});

describe("edit script properties", () => {
  const nonTopLevel = (text: string) => {
    const identity = Syntax.identifySyntax(text);
    return identity.nodes.filter((node) => node.parent !== null && node.kind !== "Comment");
  };
  const withNode = program
    .filter((text) => Syntax.identifySyntax(text).errors.length === 0 && nonTopLevel(text).length > 0)
    .chain((text) =>
      fc.tuple(fc.constant(text), fc.integer({ min: 0, max: nonTopLevel(text).length - 1 })),
    );

  test("wrapping and then unwrapping restores the source and ids", () => {
    fc.assert(
      fc.property(withNode, ([text, choice]) => {
        const identity = Syntax.identifySyntax(text);
        const target = nonTopLevel(text)[choice]!;
        const attempt = Editor.applyEditScript({
          source: text,
          identity,
          script: { version: 1, ops: [{ op: "wrap", targets: [target.id], head: "h" }] },
        });
        // Wrapping an element of a set would make it a map.
        if (!attempt.ok && attempt.errors[0]!.code === "edit/brace-kind") return;
        const wrapped = ok(attempt);
        const wrapper = wrapped.identity.nodes.find((node) =>
          wrapped.identity.nodes.some(
            (child) => child.parent === node.id && child.id === target.id,
          ),
        )!;
        const restored = ok(
          Editor.applyEditScript({
            source: wrapped.source,
            identity: wrapped.identity,
            script: { version: 1, ops: [{ op: "unwrap", target: wrapper.id }] },
          }),
        );
        expect(restored.source).toBe(text);
        expect(restored.identity.nodes.map((node) => node.id)).toEqual(
          identity.nodes.map((node) => node.id),
        );
      }),
      { numRuns: runs(300) },
    );
  });

  test("moving a node there and back restores the source", () => {
    fc.assert(
      fc.property(withNode, ([text, choice]) => {
        const identity = Syntax.identifySyntax(text);
        const target = nonTopLevel(text)[choice]!;
        const lastTop = identity.nodes.filter((node) => node.parent === null).at(-1)!;
        const moved = Editor.applyEditScript({
          source: text,
          identity,
          script: { version: 1, ops: [{ op: "move", target: target.id, to: { after: lastTop.id } }] },
        });
        if (!moved.ok) return;
        expect(Syntax.identifySyntax(moved.source).errors).toEqual([]);
        expect(moved.identity.nodes.find((node) => node.id === target.id)?.parent).toBeNull();
        const ids = moved.identity.nodes.map((node) => node.id);
        expect(new Set(ids).size).toBe(ids.length);
      }),
      { numRuns: runs(300) },
    );
  });

  test("deleting any node leaves a readable document", () => {
    fc.assert(
      fc.property(withNode, ([text, choice]) => {
        const identity = Syntax.identifySyntax(text);
        const target = nonTopLevel(text)[choice]!;
        const applied = Editor.applyEditScript({
          source: text,
          identity,
          script: { version: 1, ops: [{ op: "delete", target: target.id }] },
        });
        const parent = identity.nodes.find((node) => node.id === target.parent)!;
        if (!applied.ok) {
          // Removing half of a map entry, a reader macro's operand, or the
          // last element of a set (`{}` reads as a map) is refused.
          expect(["Map", "Set", "ReaderMacro"]).toContain(parent.kind);
          return;
        }
        const result = applied;
        expect(Syntax.identifySyntax(result.source).errors).toEqual([]);
        expect(result.changes.removed).toContain(target.id);
        for (const node of identity.nodes) {
          if (node.parent === null && node.span.end < target.span.start) {
            expect(textOf(result, node.id)).toBe(text.slice(node.span.start, node.span.end));
          }
        }
      }),
      { numRuns: runs(300) },
    );
  });
});

describe("edit script safety around comments and reader macros", () => {
  const run = (text: string, pick: (id: (snippet: string, nth?: number) => string) => unknown[]) => {
    const { id, apply } = setup(text);
    return apply(...pick(id));
  };

  test("never puts code inside a comment", () => {
    const cases: [string, (id: (snippet: string) => string) => unknown[]][] = [
      ["(a ; c\n)\n(b)", (id) => [{ op: "move", target: id("(b)"), to: { parent: id("(a ; c\n)") } }]],
      ["(a ; c\n)", (id) => [{ op: "insert", at: { parent: id("(a ; c\n)") }, text: "x" }]],
      ["(f (a ; c\n) d\n)", (id) => [{ op: "splice", target: id("(a ; c\n)") }]],
      ["(f (do a ; c\n) d\n)", (id) => [{ op: "unwrap", target: id("(do a ; c\n)") }]],
      ["(f a ; c\n d)", (id) => [{ op: "wrap", targets: [id("a"), id("; c")], head: "g" }]],
    ];
    for (const [text, ops] of cases) {
      const result = ok(run(text, ops) as Editor.ApplyEditScriptResult);
      const symbols = (source: string) =>
        Syntax.identifySyntax(source)
          .nodes.filter((node) => node.kind === "Symbol")
          .map((node) => source.slice(node.span.start, node.span.end))
          .filter((name) => name !== "do");
      expect(symbols(result.source), `${text} → ${result.source}`).toEqual(
        expect.arrayContaining(symbols(text)),
      );
      expect(Syntax.identifySyntax(result.source).errors).toEqual([]);
    }
    expect(run("(g (f ; c\n x) y\n)", (id) => [{ op: "raise", target: id("; c") }])).toMatchObject({
      ok: false,
      errors: [{ code: "edit/comment" }],
    });
  });

  test("keeps reader-macro operands attached", () => {
    expect(run("(f 'x)", (id) => [{ op: "insert", at: { before: id("x") }, text: "y" }])).toMatchObject({
      ok: false,
      errors: [{ code: "edit/reader-macro-operand" }],
    });
    expect(run("(g '(a b))", (id) => [{ op: "splice", target: id("(a b)") }])).toMatchObject({
      ok: false,
      errors: [{ code: "edit/reader-macro-operand" }],
    });
    expect(run("(f 'x)", (id) => [{ op: "replace", target: id("x"), text: "y z" }])).toMatchObject({
      ok: false,
      errors: [{ code: "edit/reader-macro-operand" }],
    });
    expect(ok(run("(f 'x)", (id) => [{ op: "replace", target: id("x"), text: "(y z)" }]) as Editor.ApplyEditScriptResult).source).toBe(
      "(f '(y z))",
    );
  });

  test("compares comments consistently across carriage returns before a newline", () => {
    for (const ending of ["\r\n", "\r\r\n", "\r\r\r\n"]) {
      const result = ok(run(`(f ; keep${ending}  x\n)`, (id) => [{ op: "delete", target: id("x") }]) as Editor.ApplyEditScriptResult);
      expect(Syntax.identifySyntax(result.source).errors).toEqual([]);
      expect(result.source).toContain("; keep");
    }
  });

  test("extracts only expressions, under free names", () => {
    expect(run("(fn [x] x)", (id) => [{ op: "extract", target: id("[x]"), name: "h" }])).toMatchObject({
      ok: false,
      errors: [{ code: "edit/not-an-expression" }],
    });
    expect(run("(define (f x) (+ x 1))", (id) => [{ op: "extract", target: id("(+ x 1)"), name: "+" }])).toMatchObject({
      ok: false,
      errors: [{ code: "edit/name-taken" }],
    });
    expect(run("(define g 1)", (id) => [{ op: "rename", target: id("g"), to: "+" }])).toMatchObject({
      ok: false,
      errors: [{ code: "edit/name-taken" }],
    });
  });

  test("checks every id before applying and never reuses a removed node's id", () => {
    const { id, apply } = setup("(f a)\n(g b)");
    expect(apply({ op: "delete", target: id("b") }, { op: "delete", target: "n99" })).toMatchObject({
      ok: false,
      errors: [{ op: 1, code: "edit/unknown-node" }],
    });
    const replaced = ok(apply({ op: "replace", target: id("a"), text: "c" }));
    expect(replaced.source).toBe("(f c)\n(g b)");
    expect(apply({ op: "delete", target: id("a") }, { op: "delete", target: id("a") })).toMatchObject({
      ok: false,
      errors: [{ op: 1, code: "edit/unknown-node" }],
    });
    const raised = ok(apply({ op: "raise", target: id("a") }));
    expect(raised.identity.nodes.map((node) => node.id)).not.toContain(id("f"));
  });
});
