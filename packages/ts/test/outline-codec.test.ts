import { describe, expect, test } from "vitest";
import fc from "fast-check";

import { Syntax } from "../src/index.js";
import { program } from "./support/programs.js";

type Row = { readonly text: string; readonly children: readonly Row[] };

const shape = (items: readonly Syntax.OutlineItem[]): Row[] =>
  items.map((item) => ({ text: item.text, children: shape(item.children) }));

const rows = (source: string) => shape(Syntax.sourceToOutline(source).items);

let counter = 0;
const outline = (items: readonly Row[]): Syntax.OutlineItem[] =>
  items.map((item) => ({ id: `row-${++counter}`, text: item.text, children: outline(item.children) }));

const row = (text: string, ...children: Row[]): Row => ({ text, children });

const print = (items: readonly Row[], options?: Syntax.OutlineToSourceOptions) =>
  Syntax.outlineToSource(outline(items), options).source;

describe("reading source as an outline", () => {
  test("follows the wisp layout", () => {
    expect(
      rows(`(defn total [x]
  (* x 2))
(total 21)
total
(now)
()`),
    ).toEqual([
      row("defn total [x]", row("* x 2")),
      row("total 21"),
      row("total"),
      row("(now)"),
      row("()"),
    ]);
  });

  test("gives a list whose head is a list an empty or list-headed row", () => {
    expect(rows("((f x)\n  y)")).toEqual([row("(f x)", row("y"))]);
    expect(rows("((fn [x]\n   x)\n 1)")).toEqual([row("", row("fn [x]", row("x")), row("1"))]);
    expect(rows("((f x) y)")).toEqual([row("(f x) y")]);
  });

  test("keeps a trailing comment on the opening line in the row's text", () => {
    expect(rows("(defn f [x] ; doubles\n  (* x 2))")).toEqual([
      row("defn f [x] ; doubles", row("* x 2")),
    ]);
    expect(rows("(f x ; why\n)")).toEqual([row("f x ; why")]);
  });

  test("reads comments as rows and nests deeper comment runs", () => {
    expect(rows("; a\n  ; b\n    ; c\n  ; d\n(x y) ; e")).toEqual([
      row("; a", row("; b", row("; c")), row("; d")),
      row("x y"),
      row("; e"),
    ]);
  });

  test("marks multi-line reader-macro lists with their prefix", () => {
    expect(rows("`(if ~test\n   nil)")).toEqual([row("` if ~test", row("nil"))]);
    expect(rows("'(a b)")).toEqual([row("'(a b)")]);
    expect(rows("'(\n  a\n  b)")).toEqual([row("'", row("a"), row("b"))]);
    expect(rows("(; why\n  a b)")).toEqual([row("", row("; why"), row("a"), row("b"))]);
  });

  test("keeps multi-line literals as one row, relative to the row's column", () => {
    expect(rows('(f\n  """two\nlines""")')).toEqual([row("f", row('"""two\nlines"""'))]);
    expect(rows("(let [a 1\n      b 2]\n  a)")).toEqual([row("let [a 1\n      b 2]", row("a"))]);
    expect(rows("(do\n  [1\n   2])")).toEqual([row("do", row("[1\n 2]"))]);
  });

  test("does not lose the document to a broken row", () => {
    const read = Syntax.sourceToOutline('(a 1)\n(b #x 2)\n(c "open');
    expect(shape(read.items)).toEqual([row("a 1"), row("b #x 2"), row('c "open')]);
    expect(read.errors.map((error) => error.id)).toEqual([
      read.items[1]!.id,
      read.items[2]!.id,
      read.items[2]!.id,
    ]);
  });

  test("uses the identity's ids as row ids", () => {
    const source = "(a\n  b)";
    const identity = Syntax.identifySyntax(source, { idPrefix: "x" });
    const read = Syntax.sourceToOutline(source, { identity });
    expect(read.items[0]!.id).toBe("x1");
    expect(read.items[0]!.children[0]!.id).toBe("x3");
  });
});

describe("printing an outline as source", () => {
  test("prints rows line for line", () => {
    expect(
      print([
        row("defn total [x]", row("* x 2")),
        row("total 21"),
        row("total"),
        row("(now)"),
        row(""),
        row("", row("f"), row("x")),
      ]),
    ).toBe("(defn total [x]\n  (* x 2))\n(total 21)\ntotal\n(now)\n(\n  f\n  x)");
  });

  test("closes lists after a trailing comment on a new line", () => {
    expect(print([row("f x ; why")])).toBe("(f x ; why\n)");
    expect(print([row("do", row("a ; note"))])).toBe("(do\n  a ; note\n)");
  });

  test("prints reader-macro rows and comment subtrees", () => {
    expect(print([row("` if ~test", row("nil"))])).toBe("`(if ~test\n  nil)");
    expect(print([row("; old", row("defn f [x]", row("* x 2")))])).toBe(
      "; old\n  ; defn f [x]\n    ; * x 2",
    );
    const source = print([row("; old", row("; (f 1)"), row("; (g 2)"))]);
    expect(rows(source)).toEqual([row("; old", row("; (f 1)"), row("; (g 2)"))]);
  });

  test("indents multi-line row text relative to the row", () => {
    expect(print([row("do", row("let [a 1\n      b 2]", row("a")))])).toBe(
      "(do\n  (let [a 1\n        b 2]\n    a))",
    );
    expect(print([row("do", row('"""keep\n  as is"""'))])).toBe('(do\n  """keep\n  as is""")');
  });

  test("reports broken rows and can comment them out", () => {
    const items = outline([row("a 1"), row("b (c", row("d")), row("e 2")]);
    const verbatim = Syntax.outlineToSource(items);
    expect(verbatim.errors).toEqual([{ id: items[1]!.id, message: expect.stringMatching(/Unclosed/) }]);
    const commented = Syntax.outlineToSource(items, { brokenRows: "comment" });
    expect(commented.source).toBe("(a 1)\n; b (c\n  ; d\n(e 2)");
    expect(Syntax.identifySyntax(commented.source).errors).toEqual([]);
    expect(commented.identity.nodes.find((node) => node.id === items[2]!.id)).toBeDefined();
  });

  test("gives each row's node the row's id", () => {
    const items = outline([row("defn f [x]", row("* x 2")), row("; note"), row("f 3")]);
    const printed = Syntax.outlineToSource(items, { idPrefix: "n" });
    for (const item of [items[0]!, items[0]!.children[0]!, items[1]!, items[2]!]) {
      const node = printed.identity.nodes.find((candidate) => candidate.id === item.id)!;
      const span = printed.rows.find((candidate) => candidate.id === item.id)!.span;
      expect(node.span).toEqual(span);
    }
  });
});

describe("codec edge cases", () => {
  const exact = (source: string) => {
    const read = Syntax.sourceToOutline(source);
    return Syntax.outlineToSource(read.items, { base: { source, identity: read.identity } }).source;
  };

  test("keeps a broken row's parentheses", () => {
    const source = "(a\n  (b #x 2)\n  c)";
    expect(rows(source)).toEqual([row("a", row("b #x 2"), row("c"))]);
    expect(print(rows(source))).toBe(source);
    expect(exact(source)).toBe(source);
  });

  test("does not mistake a quoted head for a prefixed list", () => {
    const source = "(' a\n  b)";
    expect(rows(source)).toEqual([row("", row("' a"), row("b"))]);
    expect(exact(source)).toBe(source);
    expect(Syntax.identifySyntax(print(rows(source))).nodes[1]!.kind).toBe("ReaderMacro");
  });

  test("prints its own base exactly, odd layout included", () => {
    for (const source of [
      "( a b )",
      "(a b\n)",
      "; crlf\r\n(a)",
      "; trailing spaces   \n(a)",
      '(do\n  """x\n; not a comment"""\n  y)',
      "(a\n  (b c",
      "((a b\n))",
    ]) {
      expect(exact(source), JSON.stringify(source)).toBe(source);
    }
  });

  test("reads printed source back as the same rows", () => {
    for (const source of ["((a b\n))", "(a b\n)", "(do\n  (a b\n  ))"]) {
      const { items } = Syntax.sourceToOutline(source);
      const printed = Syntax.outlineToSource(items);
      expect(Syntax.sourceToOutline(printed.source, { identity: printed.identity }).items, source).toEqual(items);
    }
  });
});

describe("layout survives through a base", () => {
  const source = `;; Pricing

(define   tax-rate 0.08) ; set by finance

(define (total revenue)
    ; four-space body
    (+ revenue
       (* revenue tax-rate)))
`;

  test("reproduces the source exactly", () => {
    const read = Syntax.sourceToOutline(source);
    const printed = Syntax.outlineToSource(read.items, { base: { source, identity: read.identity } });
    expect(printed.source).toBe(source);
    expect(printed.identity).toEqual(read.identity);
  });

  test("keeps the layout of rows that did not change", () => {
    const read = Syntax.sourceToOutline(source);
    const items = read.items.map((item) =>
      item.text === "define   tax-rate 0.08" ? { ...item, text: "define tax-rate 0.09" } : item,
    );
    const printed = Syntax.outlineToSource(items, { base: { source, identity: read.identity } });
    expect(printed.source).toBe(source.replace("define   tax-rate 0.08", "define tax-rate 0.09"));
  });

  test("lays out moved rows canonically and keeps the rest", () => {
    const read = Syntax.sourceToOutline(source);
    const [comment, rate, note, total] = read.items;
    const [head, body] = total!.children;
    const moved = [comment!, { ...total!, children: [body!, head!] }, rate!, note!];
    const printed = Syntax.outlineToSource(moved, { base: { source, identity: read.identity } });
    // Rows keep their own text, and a moved row gets the canonical separator.
    expect(printed.source).toBe(`;; Pricing
(define (total revenue)
  (+ revenue
     (* revenue tax-rate))
  ; four-space body
)
(define   tax-rate 0.08) ; set by finance
`);
    expect(shape(Syntax.sourceToOutline(printed.source).items)).toEqual(shape(moved));
  });
});

describe("codec properties", () => {
  const readable = program.filter((source) => Syntax.identifySyntax(source).errors.length === 0);

  test("source → outline → source with its base is the identity", () => {
    fc.assert(
      fc.property(program, (source) => {
        const read = Syntax.sourceToOutline(source);
        const printed = Syntax.outlineToSource(read.items, {
          base: { source, identity: read.identity },
        });
        expect(printed.source).toBe(source);
      }),
      { numRuns: 500 },
    );
  });

  test("outline → source → outline is the identity", () => {
    fc.assert(
      fc.property(readable, (source) => {
        const { items } = Syntax.sourceToOutline(source);
        const printed = Syntax.outlineToSource(items);
        expect(Syntax.identifySyntax(printed.source).errors).toEqual([]);
        const again = Syntax.sourceToOutline(printed.source, { identity: printed.identity });
        expect(again.items).toEqual(items);
      }),
      { numRuns: 500 },
    );
  });

  test("printing is line for line when there is no base", () => {
    fc.assert(
      fc.property(readable, (source) => {
        const { items } = Syntax.sourceToOutline(source);
        const printed = Syntax.outlineToSource(items);
        const count = (list: readonly Syntax.OutlineItem[]): number =>
          list.reduce((sum, item) => sum + 1 + count(item.children), 0);
        const lineStarts = new Set<number>();
        for (const { span } of printed.rows) {
          lineStarts.add(printed.source.slice(0, span.start).split("\n").length);
        }
        expect(lineStarts.size).toBe(count(items));
      }),
      { numRuns: 300 },
    );
  });
});
