import { describe, expect, test } from "vitest";
import fc from "fast-check";
import { Editor, Engine, Evaluator, Expander, Builtins, Syntax } from "../src/index.js";
import { parse, toSExprMany } from "../src/reader/index.js";

const runs = (count: number) => count * Number(process.env["FORMA_PROPERTY_SCALE"] ?? 1);
const setup = (source: string) => {
  const identity = Syntax.identifySyntax(source);
  const id = (text: string) => {
    const node = identity.nodes.find(
      (node) => source.slice(node.span.start, node.span.end) === text,
    );
    if (!node) throw new Error(`missing ${text}`);
    return node.id;
  };
  const apply = (...ops: unknown[]) =>
    Editor.applyEditScript({ source, identity, script: { version: 1, ops } });
  return { source, identity, id, apply };
};
const ok = (result: Editor.ApplyEditScriptResult) => {
  if (!result.ok) throw new Error(JSON.stringify(result.errors));
  return result;
};
const atoms = (source: string) =>
  Syntax.identifySyntax(source)
    .nodes.filter((node) => ["Symbol", "Number", "String", "Boolean"].includes(node.kind))
    .map((node) => source.slice(node.span.start, node.span.end));

describe("structural edit regressions", () => {
  test.each([
    ["delete", '(f a"s"b)', '"s"', ["f", "a", "b"]],
    ["delete", "(f a; c\nb)", "; c", ["f", "a", "b"]],
    ["splice", "(f a(b)c)", "(b)", ["f", "a", "b", "c"]],
    ["unwrap", "(f a(g b)c)", "(g b)", ["f", "a", "b", "c"]],
    ["raise", "(f a(g b)c)", "b", ["f", "a", "b", "c"]],
  ])("%s preserves adjacent atoms in %s", (op, source, target, expected) => {
    const { id, apply } = setup(source as string);
    expect(atoms(ok(apply({ op, target: id(target as string) })).source)).toEqual(expected);
  });

  test("insert, replace, move, and rename keep tokens separate", () => {
    const doc = setup('(f a"s")\n(g)');
    expect(
      atoms(ok(doc.apply({ op: "insert", at: { before: doc.id('"s"') }, text: "b" })).source),
    ).toEqual(["f", "a", "b", '"s"', "g"]);
    expect(
      atoms(ok(doc.apply({ op: "replace", target: doc.id('"s"'), text: "b" })).source),
    ).toEqual(["f", "a", "b", "g"]);
    const move = setup('(f a"s"b)\n(g)');
    expect(
      atoms(
        ok(move.apply({ op: "move", target: move.id('"s"'), to: { parent: move.id("(g)") } }))
          .source,
      ),
    ).toEqual(["f", "a", "b", "g", '"s"']);
    const rename = setup("(let [x 1] [1x])");
    expect(ok(rename.apply({ op: "rename", target: rename.id("x"), to: "e5" })).source).toContain(
      "[1 e5]",
    );
  });

  test("removing an empty wrapper preserves the following comment", () => {
    for (const [source, op, target] of [
      ["(f () ; keep\n b)", "splice", "()"],
      ["(f (g) ; keep\n b)", "unwrap", "(g)"],
    ]) {
      const doc = setup(source!);
      expect(ok(doc.apply({ op, target: doc.id(target!) })).source).toContain("; keep");
    }
  });

  test("a reader prefix's comment cannot become its operand", () => {
    const doc = setup("(f ' ; c\n x)");
    expect(doc.apply({ op: "replace", target: doc.id("; c"), text: "y" }).ok).toBe(false);
    expect(doc.apply({ op: "wrap", targets: [doc.id("; c")], head: "g" }).ok).toBe(false);
    expect(ok(doc.apply({ op: "replace", target: doc.id("; c"), text: "; new" })).source).toContain(
      "' ; new\n x",
    );
  });

  test("replace retires descendants even if its root keeps an ID", () => {
    const doc = setup("(f (g a) b)");
    const result = doc.apply(
      { op: "replace", target: doc.id("(g a)"), text: "(h)" },
      { op: "replace", target: doc.id("g"), text: "k" },
    );
    expect(result).toMatchObject({ ok: false, errors: [{ op: 1, code: "edit/unknown-node" }] });
  });

  test("random scripts preserve untouched atom text and IDs across lexical seams", () => {
    const atom = fc.constantFrom("a", "b", "1", "2", "true", ":k", "e5", "-");
    fc.assert(
      fc.property(
        atom,
        atom,
        fc.array(fc.constantFrom("replace", "splice", "unwrap", "raise", "delete"), {
          minLength: 1,
          maxLength: 8,
        }),
        (left, right, operations) => {
          let source = `(${left}[]${right})`;
          let identity = Syntax.identifySyntax(source);
          const original = identity.nodes
            .filter((node) => node.kind !== "List" && node.kind !== "Vector")
            .map((node) => ({ id: node.id, text: source.slice(node.span.start, node.span.end) }));
          for (const operation of operations) {
            const middle = identity.nodes.find(
              (node) =>
                node.parent === identity.nodes[0]!.id &&
                !original.some((originalNode) => originalNode.id === node.id),
            );
            if (!middle) break;
            // Replacement adds a wrapper for the next operation to remove.
            const op =
              operation === "replace" || middle.kind !== "List"
                ? { op: "replace", target: middle.id, text: "(g)" }
                : {
                    op: operation,
                    target:
                      operation === "raise"
                        ? identity.nodes.find((node) => node.parent === middle.id)!.id
                        : middle.id,
                  };
            const next = ok(
              Editor.applyEditScript({ source, identity, script: { version: 1, ops: [op] } }),
            );
            for (const node of original) {
              const retained = next.identity.nodes.find((candidate) => candidate.id === node.id)!;
              expect(next.source.slice(retained.span.start, retained.span.end)).toBe(node.text);
            }
            source = next.source;
            identity = next.identity;
          }
        },
      ),
      { numRuns: runs(200), seed: 17 },
    );
  });
});

describe("outline whitespace regressions", () => {
  test("unchanged source and identity are exact, including arbitrary broken input", () => {
    const check = (source: string) => {
      const read = Syntax.sourceToOutline(source);
      const printed = Syntax.outlineToSource(read.items, {
        base: { source, identity: read.identity },
      });
      expect(printed.source).toBe(source);
      expect(printed.identity).toEqual(read.identity);
      const reorder = (items: readonly Syntax.OutlineItem[]): Syntax.OutlineItem[] =>
        items.map((item) => ({
          children: reorder(item.children),
          text: item.text,
          id: item.id,
        }));
      expect(
        Syntax.outlineToSource(reorder(read.items), { base: { source, identity: read.identity } })
          .source,
      ).toBe(source);
    };
    ["( a\n b)", "'(\ra\n b)", "(a ; c \r\n b)", '"open ', '(a\n """open\n'].forEach(check);
    fc.assert(fc.property(fc.string(), check), { numRuns: runs(300), seed: 8 });
  });

  test.each(["(a ; c \n b)", "(a ; c\r\n b)", "; c ", "a ; c\r\nb"])(
    "canonical printing retains row text and comment IDs: %s",
    (source) => {
      const read = Syntax.sourceToOutline(source);
      const printed = Syntax.outlineToSource(read.items);
      expect(Syntax.sourceToOutline(printed.source, { identity: printed.identity }).items).toEqual(
        read.items,
      );
    },
  );

  test("editing a child preserves padding after the parent's opening delimiter", () => {
    const source = "( a\n b)";
    const read = Syntax.sourceToOutline(source);
    const items = read.items.map((item) => ({
      ...item,
      children: item.children.map((child) => ({ ...child, text: "c" })),
    }));
    expect(
      Syntax.outlineToSource(items, { base: { source, identity: read.identity } }).source,
    ).toBe("( a\n c)");
  });
});

describe("macro tracing regressions", () => {
  test("cached prelude templates acquire only the current call's origin", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 30 }), (padding) => {
        const expr = Expander.expandProgramSync(
          toSExprMany(parse(" ".repeat(padding) + "(not 1)").redTree),
          { builtins: Builtins.defaultBuiltins },
        ).exprs[0]!;
        if (expr._tag !== "List") throw new Error("expected if");
        const trace = Evaluator.sourceTraceOf(expr.items[2]!);
        expect(trace.macroOrigins).toHaveLength(1);
        expect(trace.loc.start).toBe(padding);
      }),
      { numRuns: runs(100), seed: 5 },
    );
  });

  test.each(["", "\n(if false ~unused 0)"])(
    "identity macros preserve argument traces and observations%s",
    async (suffix) => {
      const source = "(macro (id x) x)\n(id (+ 1 2))\n(id (+ 3 4))" + suffix;
      const result = await Engine.evaluate({ source, observe: {} });
      expect(result.diagnostics).toEqual([]);
      for (const [text, value] of [
        ["(+ 1 2)", "3"],
        ["(+ 3 4)", "7"],
      ]) {
        const record = result.observations?.records.find(
          (record) => source.slice(record.span.start, record.span.end) === text,
        );
        expect(record?.count).toBe(1);
        expect(Evaluator.printKValue(record!.value)).toBe(value);
      }
      const bad = source.replace("(+ 1 2)", '(+ 1 "x")');
      const failure = await Engine.evaluate({ source: bad, observe: {} });
      const span = failure.diagnostics[0]?.span;
      expect(bad.slice(span?.startOffset, span?.endOffset)).toBe('(+ 1 "x")');
    },
  );

  test("a shared template failure belongs to the first call that ran", async () => {
    const source = "(macro (m x) `(do ~x (undefined-fn 1)))\n(m 1)\n(m 2)";
    const result = await Engine.evaluate({ source, observe: {} });
    expect(result.diagnostics[0]?.span?.startOffset).toBe(source.indexOf("(m 1)"));
    expect(
      result.observations?.records.find((record) => record.span.start === source.indexOf("(m 1)"))
        ?.failure,
    ).toBeDefined();
  });
});

describe("symbol syntax regressions", () => {
  test("tagged constructors, aliases, and record types resolve without treating type variables as values", () => {
    const source =
      "(define a 1)\n(type (Box a) {:value a})\n(class Point {:x Int})\n(type Maybe (Tagged (Some Int) None))\n(Point {:x 1})\n(Maybe.Some 1)\n(match (Some 1) (Some x) x None 0)";
    const index = Editor.indexSymbols([{ sourceId: "doc", source }]);
    expect(
      index.definitions
        .filter((definition) => definition.scope === "global")
        .map((definition) => definition.name),
    ).toEqual(["a", "Box", "Point", "Maybe", "Some", "None"]);
    expect(index.references.filter((reference) => reference.name === "a")).toEqual([]);
    expect(
      index.references
        .filter((reference) => ["Point", "Maybe.Some"].includes(reference.name))
        .every((reference) => reference.resolution === "definition"),
    ).toBe(true);
    expect(
      Editor.findReferences(index, { sourceId: "doc", offset: source.indexOf("Some") }).references,
    ).toHaveLength(2);
  });

  test("runtime quasiquotes reference only active unquotes", () => {
    const source = "(define a 1)\n`(a ~a `(a ~a))";
    const index = Editor.indexSymbols([{ sourceId: "doc", source }]);
    expect(
      Editor.findReferences(index, {
        sourceId: "doc",
        offset: source.indexOf("a 1"),
      }).references.map((ref) => ref.span.start),
    ).toEqual([source.indexOf("~a") + 1]);
  });
});

describe("retired anchor regressions", () => {
  test("fresh external and future generated anchors are still accepted", () => {
    const identity = Syntax.identifySyntax("(a)");
    for (const id of ["external", "n01", `n${identity.nextId + 10}`]) {
      const result = Syntax.reconcileSyntax({ source: "(a)", identity }, "(b)", {
        anchors: [{ id, span: { start: 1, end: 2 } }],
      });
      expect(result.nodes.some((node) => node.id === id)).toBe(true);
    }
  });
  test("anchors cannot revive explicitly retired or previously dropped generated IDs", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 20 }), (count) => {
        const source = "(" + Array.from({ length: count }, (_, i) => `a${i}`).join(" ") + ")";
        const identity = Syntax.identifySyntax(source);
        const removed = identity.nodes.at(-1)!;
        const nextSource = "(x)";
        const anchor = { id: removed.id, span: { start: 1, end: 2 } };
        const retired = Syntax.reconcileSyntax({ source, identity }, nextSource, {
          anchors: [anchor],
          retired: [removed.id],
        });
        expect(retired.nodes.some((node) => node.id === removed.id)).toBe(false);
        const dropped = Syntax.reconcileSyntax({ source, identity }, "", {
          retired: identity.nodes.map((node) => node.id),
        });
        const restored = Syntax.reconcileSyntax({ source: "", identity: dropped }, nextSource, {
          anchors: [anchor],
        });
        expect(restored.nodes.some((node) => node.id === removed.id)).toBe(false);
      }),
      { numRuns: runs(100), seed: 3 },
    );
  });
});
