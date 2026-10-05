/**
 * Review B: the outline codec (src/syntax/outline.ts).
 *
 * Laws under test:
 *   exact      print(read(s), base: s) = s, for every string s
 *   round trip read(print(read(s))) = read(s) with ids, and print(read(s)) has no
 *              parse errors, for every s without parse errors
 *   outline    read(print(o)) = o, for every well-formed outline o
 *
 * Known bugs 6–9 are pinned in outline-codec.test.ts ("codec edge cases"); the
 * first block below re-checks each patch against close variants. Siblings that
 * still fail are `test.fails` with a minimal repro and the root cause.
 */
import { describe, expect, test } from "vitest";
import fc from "fast-check";

import { Syntax } from "../src/index.js";
import { pick, sources } from "./support/programs.js";
import { runs } from "./support/runs.js";

const RUNS = runs(1000);

type Row = { readonly text: string; readonly children: readonly Row[] };
const row = (text: string, ...children: Row[]): Row => ({ text, children });
const shape = (items: readonly Syntax.OutlineItem[]): Row[] =>
  items.map((item) => ({ text: item.text, children: shape(item.children) }));
const rows = (source: string) => shape(Syntax.sourceToOutline(source).items);

let counter = 0;
const withIds = (items: readonly Row[]): Syntax.OutlineItem[] =>
  items.map((item) => ({ id: `r${++counter}`, text: item.text, children: withIds(item.children) }));

/** print(read(s), base: s) */
const exact = (source: string) => {
  const read = Syntax.sourceToOutline(source);
  return Syntax.outlineToSource(read.items, { base: { source, identity: read.identity } });
};
/** print(read(s)) without a base */
const canonical = (source: string) => Syntax.outlineToSource(Syntax.sourceToOutline(source).items);
/** read(print(read(s))) next to read(s) */
const roundTrip = (source: string) => {
  const { items } = Syntax.sourceToOutline(source);
  const printed = Syntax.outlineToSource(items);
  const again = Syntax.sourceToOutline(printed.source, { identity: printed.identity });
  return { items, printed, again: again.items, errors: Syntax.identifySyntax(printed.source).errors };
};

// =============================================================================
// Generators
// =============================================================================

const readable = (source: string) => Syntax.identifySyntax(source).errors.length === 0;
const anySource = sources({ broken: true, tame: false });
const tameSource = sources({ broken: true, tame: true });
const cleanSource = sources({ broken: false, tame: false }).filter(readable);
const tameCleanSource = sources({ broken: false, tame: true }).filter(readable);

// --- Outlines ---------------------------------------------------------------

const rowText = pick(
  "a", "f x", "f x ; why  ", "; c  ", "defn total [x]", "* x 2", "' a", "'", "`", "~", "~@", "' if", "` if ~test", "~@ xs", "'(a b)", "(now)", "()", "(f x)",
  "; c", ";; note", "; (f 1)", "f x ; why", "a ; c", "", "[1\n 2]", '"""a\nb"""', "let [a 1\n      b 2]", '"s"', ":k", "-1.5e3",
  "{:a 1}", "{a b c}", "' ; c\nx", "a\nb", "(a\n b)", "'(a\n b)", "a (b\n c)", "' ; c", "` ` x", "a [1\n 2]", "; a\n; b",
  "a ; c\nb", "~@ (f\n x)", "' [a\n b]", "' a ; c", "a\tb", "[1\n\n 2]", "[1\n\t2]", "{:a 1\n :b 2}", "f [x] ; doc", "'[a b]",
  "~@xs", '"x\\ny"', '"two\nlines"', "true", "a.b c.d", "#", "(a", "a)", "  a  ", "~ x", "'a b", "' 'a", "x ;", "&", "$x.y",
);

const topLevel = (text: string) => {
  const identity = Syntax.identifySyntax(text);
  const top = identity.nodes.filter((node) => node.parent === null);
  return { identity, top, code: top.filter((node) => node.kind !== "Comment") };
};
const lineOf = (text: string, offset: number) => text.slice(0, offset).split("\n").length;
/** A list (or glued prefixed list) with an element past its opening line: reading makes it a row of its own. */
const outlined = (text: string, identity: Syntax.SyntaxIdentity, node: Syntax.SyntaxNode): boolean => {
  const children = (id: string) => identity.nodes.filter((x) => x.parent === id);
  let list = node;
  if (node.kind === "ReaderMacro") {
    const [inner] = children(node.id);
    if (!inner || inner.kind !== "List" || !/^(~@|`|'|~)$/.test(text.slice(node.span.start, inner.span.start))) return false;
    list = inner;
  }
  if (list.kind !== "List") return false;
  const opening = lineOf(text, node.span.start);
  return children(list.id).some((x) => lineOf(text, x.span.start) !== opening || outlined(text, identity, x));
};
const commentOnly = (r: Row): boolean => r.text.startsWith(";") && !r.text.includes("\n") && r.children.every(commentOnly);

/**
 * Well-formedness the outline law needs, found by shrinking counterexamples.
 * Each condition says the row is something reading could have produced.
 */
const wellFormedRow = (r: Row): boolean => {
  // W1: surrounding whitespace is absent; trailing spaces inside a comment
  // belong to that comment and are retained by the grammar.
  if (r.text !== r.text.trimStart() || r.text.endsWith("\r")) return false;
  if (r.text !== r.text.trimEnd()) {
    const last = topLevel(r.text).top.at(-1);
    if (last?.kind !== "Comment" || last.span.end !== r.text.length) return false;
  }
  // W2: a comment row is one line and its subtree is comments (the printer comments it out).
  if (r.text.startsWith(";")) return commentOnly(r);
  // W3: with children, a leading `' ` is a prefix marker; the rest must not start with a comment.
  const marker = r.children.length > 0 ? /^(~@|`|'|~)(?:\s+|$)/.exec(r.text) : null;
  const text = marker ? r.text.slice(marker[0].length) : r.text;
  if (marker && text.startsWith(";")) return false;
  const { identity, top, code } = topLevel(text);
  // W4: the text reads on its own.
  if (identity.errors.length > 0) return false;
  // W5: every element starts on the text's first line (`a\nb` would read as `a` with child `b`).
  const firstLine = text.indexOf("\n") < 0 ? text.length : text.indexOf("\n");
  if (top.some((node) => node.span.start > firstLine)) return false;
  // W6: no element is a list that reading would outline (`a (b\n c)`).
  if (top.some((node) => outlined(text, identity, node))) return false;
  if (r.children.length === 0) {
    // W7: a childless row is not empty (it prints nothing).
    if (top.length === 0) return false;
    // W8: a one-element childless row has no trailing comment (`x ; c` reads as two rows).
    if (code.length === 1 && top.length > 1) return false;
    // W9: a one-element childless row is not a list of two or more (`(f x)` reads as `f x`).
    const only = code[0]!;
    if (code.length === 1 && only.kind === "List" && identity.nodes.filter((x) => x.parent === only.id && x.kind !== "Comment").length >= 2) return false;
  } else {
    // W10: a row with children has two code elements in text plus children, or a child with children
    // (`(\n  a)` and `(a\n  ; c\n)` read as one verbatim element).
    const codeChildren = r.children.filter((child) => !child.text.startsWith(";"));
    if (code.length + codeChildren.length < 2 && !codeChildren.some((child) => child.children.length > 0)) return false;
  }
  return true;
};
const wellFormed = (items: readonly Row[]): boolean => items.every((r) => wellFormedRow(r) && wellFormed(r.children));

const outlines = (filter: (r: Row) => boolean): fc.Arbitrary<Row[]> =>
  fc.letrec<{ rows: Row[]; row: Row }>((tie) => ({
    row: fc.record({ text: rowText, children: fc.oneof({ depthSize: "small" }, fc.constant([] as Row[]), tie("rows")) }).filter(filter),
    rows: fc.array(tie("row"), { maxLength: 4 }),
  })).rows;
const anyOutline = outlines(() => true);
const wellFormedOutline = outlines(wellFormedRow);

// =============================================================================
// Known bugs 6–9: the patches against close variants
// =============================================================================

describe("patched bugs hold for close variants", () => {
  test("6: a broken one-line row keeps its parentheses", () => {
    for (const source of ["(a\n  (b #x 2)\n  c)", "(a\n  (b ] 2)\n  c)", "(b #x 2)", "(a\n  (# b)\n  c)", "(a\n  (b 1e)\n  c)"]) {
      expect(canonical(source).source, JSON.stringify(source)).toBe(source);
      expect(exact(source).source).toBe(source);
    }
  });

  test("7: every reader-macro head is kept apart from a prefix marker", () => {
    for (const [source, expected] of [
      ["(' a\n  b)", [row("", row("' a"), row("b"))]],
      ["(~@ a\n  b)", [row("", row("~@ a"), row("b"))]],
      ["(` a\n  b)", [row("", row("` a"), row("b"))]],
      // Continuation lines are relative to the element's own column (1 here).
      ["(' ; c\n  x\n  y)", [row("", row("' ; c\n x"), row("y"))]],
      ["'(' a\n  b)", [row("' ' a", row("b"))]],
      ["('a\n  b)", [row("'a", row("b"))]],
    ] as const) {
      expect(rows(source), source).toEqual(expected);
      expect(exact(source).source).toBe(source);
      const trip = roundTrip(source);
      expect(trip.again).toEqual(trip.items);
    }
  });

  test("8: odd layout the patch covers prints exactly", () => {
    for (const source of [
      "( a b )",
      "[ a b ]",
      "'( a b )",
      "(a b\n)",
      "; crlf\r\n(a)",
      "(a\r\n  b)",
      "; trailing spaces   \n(a)",
      "(a\n  ; trailing   \n  b)",
      '(do\n  """x\n; not a comment"""\n  y)',
      '(do\n  "x\n; not a comment"\n  y)',
      "(a\n  (b c",
      "(a b",
      "(a\n  b ; c",
      "'(a\n  b",
      "  (a)  \n\n",
      "(a\rb\n c)",
      "' ; c\n x",
      "(a\"s\"b)",
    ]) {
      expect(exact(source).source, JSON.stringify(source)).toBe(source);
    }
  });

  test("9: lists closed on their own line read back as the same rows", () => {
    for (const source of ["((a b\n))", "('(a b\n))", "([a\n b])", "(x ((a b\n)))", "(do\n  (a b\n  ))", "((a b ; c\n))"]) {
      const trip = roundTrip(source);
      expect(trip.errors, source).toEqual([]);
      expect(trip.again, source).toEqual(trip.items);
    }
  });
});

// =============================================================================
// Siblings that still fail
// =============================================================================

describe("sibling bugs", () => {
  // S1. Root cause: for a row with children, layoutText reuses `raw`, which starts at the
  // first header element, so the text between `(` and the header is not kept (the #8 patch
  // only reuses `full` for childless rows).
  test("S1 exact: whitespace after `(` of a row with children", () => {
    expect(exact("( a\n b)").source).toBe("( a\n b)"); // actual "(a\n b)"
  });
  test("S1 exact: whitespace after `'(` of a prefixed row", () => {
    expect(exact("'( a\n b)").source).toBe("'( a\n b)"); // actual "'(a\n b)"
  });
  test("S1 exact: lone CR after `(`", () => {
    expect(exact("(\ra\n b)").source).toBe("(\ra\n b)"); // actual "(a\n b)"
  });

  // S2. Root cause: printRow trims the row's text and compares the trimmed text with the
  // base row's text, so a row whose read text ends in whitespace (a header comment's trailing
  // spaces or CR, an unterminated string that runs to EOF) is "changed" and re-laid out.
  test("S2 exact: trailing spaces of a header comment", () => {
    expect(exact("(a ; c \n b)").source).toBe("(a ; c \n b)"); // actual "(a ; c\n b)"
  });
  test("S2 exact: CRLF after a header comment", () => {
    expect(exact("(a ; c\r\n b)").source).toBe("(a ; c\r\n b)"); // actual "(a ; c\n b)"
  });
  test("S2 exact: whitespace swallowed by an unterminated string at EOF", () => {
    expect(exact('"open ').source).toBe('"open '); // actual '"open'
  });
  test("S2 exact: newline swallowed by an unterminated triple-quoted string", () => {
    expect(exact('(a\n  """open\n').source).toBe('(a\n  """open\n'); // actual '(a\n  """open'
  });

  // S3. Same root cause as S2, other law: the header text read is "a ; c " but the
  // printer writes "a ; c".
  test("S3 round trip: a header comment's trailing whitespace is lost", () => {
    const trip = roundTrip("(a ; c \n b)");
    expect(shape(trip.again)).toEqual(shape(trip.items)); // actual text "a ; c", expected "a ; c "
  });
  test("S3 round trip: a header comment's CR is lost", () => {
    const trip = roundTrip("(a ; c\r\n b)");
    expect(shape(trip.again)).toEqual(shape(trip.items)); // actual text "a ; c", expected "a ; c\r"
  });

  // S4. Root cause: printComment records the row's span with `trimEnd()`, but the comment
  // node runs to the newline (trailing spaces, CR), so the anchor misses and the
  // comment row gets a fresh id in the printed identity.
  test("S4 round trip: a comment row with trailing whitespace keeps its id", () => {
    const items = withIds([row("; c ")]);
    const printed = Syntax.outlineToSource(items);
    expect(printed.source).toBe("; c ");
    expect(printed.rows).toEqual([{ id: items[0]!.id, span: { start: 0, end: 4 } }]); // actual end 3
    expect(Syntax.sourceToOutline(printed.source, { identity: printed.identity }).items).toEqual(items); // actual: fresh id
  });
  test("S4 round trip: a CRLF comment row keeps its id", () => {
    const trip = roundTrip("a ; c\r\nb");
    expect(trip.again).toEqual(trip.items);
  });

  // S5. Outside the stated laws, noted for completeness. Root cause: a row whose text has an
  // unclosed string or delimiter prints as `(` + text + `)`, and the `)` lands inside it, so
  // each print adds a `)`.
  test.fails("S5: canonical printing of a broken document is not idempotent", () => {
    const once = canonical('(a "open').source; // '(a "open)'
    expect(canonical(once).source).toBe(once); // actual '(a "open))'
  });
});

// =============================================================================
// Pinned correct behavior
// =============================================================================

describe("pinned behavior", () => {
  test("comment-out mode always yields a readable document", { timeout: 60_000 }, () => {
    fc.assert(
      fc.property(anyOutline, (items) => {
        const printed = Syntax.outlineToSource(withIds(items), { brokenRows: "comment" });
        expect(Syntax.identifySyntax(printed.source).errors).toEqual([]);
      }),
      { numRuns: RUNS, seed: 7 },
    );
  });

  test("printing with its own base reproduces the identity too", { timeout: 60_000 }, () => {
    fc.assert(
      fc.property(anySource, (source) => {
        const read = Syntax.sourceToOutline(source);
        const printed = Syntax.outlineToSource(read.items, { base: { source, identity: read.identity } });
        fc.pre(printed.source === source);
        expect(printed.identity.nodes).toEqual(read.identity.nodes);
      }),
      { numRuns: RUNS, seed: 7 },
    );
  });

  test("ill-formed outlines: each well-formedness condition is needed", () => {
    const reread = (items: readonly Row[]) => rows(Syntax.outlineToSource(withIds(items)).source);
    expect(reread([row("  a  ")])).toEqual([row("a")]); // W1
    expect(reread([row(";; note", row("a"))])).toEqual([row(";; note", row("; a"))]); // W2
    expect(reread([row("' ; c", row("a"), row("b"))])).toEqual([row("'", row("; c"), row("a"), row("b"))]); // W3
    expect(reread([row("a", row("~"))])).toEqual([row("a", row("~)"))]); // W4
    expect(reread([row("a\nb")])).toEqual([row("a", row("b"))]); // W5
    expect(reread([row("a (b\n c)")])).toEqual([row("a", row("b", row("c")))]); // W6
    expect(reread([row("")])).toEqual([]); // W7
    expect(reread([row("a ; c")])).toEqual([row("a"), row("; c")]); // W8
    expect(reread([row("(f x)")])).toEqual([row("f x")]); // W9
    expect(reread([row("", row("a"))])).toEqual([row("(\n  a)")]); // W10
  });
});

// =============================================================================
// Properties
// =============================================================================

describe("codec laws on a rich generator", () => {
  const exactLaw = (source: string) => {
    expect(exact(source).source).toBe(source);
  };
  const roundTripLaw = (source: string) => {
    const trip = roundTrip(source);
    expect(trip.errors).toEqual([]);
    expect(trip.again).toEqual(trip.items);
  };

  // Seed 1 shrinks to S1: `'( true "" ; c\na )` prints as `'(true "" ; c\na )`. Other seeds
  // give S2: "(a ; c \n0" -> "(a ; c\n0", '"""open\nx ' -> '"""open\nx'.
  test("exact: print(read(s), base: s) = s for every s", { timeout: 120_000 }, () => {
    fc.assert(fc.property(anySource, exactLaw), { numRuns: RUNS, seed: 1 });
  });

  test("exact holds once the S1/S2 layouts are left out", { timeout: 120_000 }, () => {
    const unterminatedAtEnd = (s: string) =>
      /\s$/.test(s) && Syntax.identifySyntax(s).errors.some((error) => /Unterminated/.test(error.message));
    // Tame layout still makes `( ` from an empty unclosed list and its next sibling.
    const spaceAfterParen = (s: string) => /[(][ \t\r]/.test(s);
    fc.assert(fc.property(tameSource.filter((s) => !unterminatedAtEnd(s) && !spaceAfterParen(s)), exactLaw), { numRuns: RUNS, seed: 1 });
  });

  // Seed 1 shrinks to S4: "a ; c \n0" (the comment row's id is lost). Other seeds give
  // S3: "(a a ; c\r\n:k )" (header text "a a ; c\r" reads back as "a a ; c").
  test("round trip: read(print(read(s))) = read(s) for readable s", { timeout: 120_000 }, () => {
    fc.assert(fc.property(cleanSource, roundTripLaw), { numRuns: RUNS, seed: 1 });
  });

  test("round trip holds once the S3/S4 layouts are left out", { timeout: 120_000 }, () => {
    fc.assert(fc.property(tameCleanSource, roundTripLaw), { numRuns: RUNS, seed: 1 });
  });

  test("outline: read(print(o)) = o, ids included, for well-formed o", { timeout: 120_000 }, () => {
    fc.assert(
      fc.property(wellFormedOutline, (items) => {
        const outline = withIds(items);
        const printed = Syntax.outlineToSource(outline);
        expect(Syntax.identifySyntax(printed.source).errors).toEqual([]);
        expect(Syntax.sourceToOutline(printed.source, { identity: printed.identity }).items).toEqual(outline);
      }),
      { numRuns: RUNS, seed: 1 },
    );
  });

  // The conditions are needed: seed 1 shrinks to a row "a ; c\nb" (W5), which reads back
  // as "a", "; c", "b".
  test.fails("outline: read(print(o)) = o for any outline", { timeout: 120_000 }, () => {
    fc.assert(
      fc.property(anyOutline, (items) => {
        expect(rows(Syntax.outlineToSource(withIds(items)).source)).toEqual(items);
      }),
      { numRuns: RUNS, seed: 1 },
    );
  });

  test("the generators reach the interesting cases", () => {
    const sample = fc.sample(tameCleanSource, { numRuns: 500, seed: 3 });
    expect(sample.filter((s) => Syntax.sourceToOutline(s).items.some((item) => item.children.length > 0)).length).toBeGreaterThan(100);
    const outlinesSample = fc.sample(wellFormedOutline, { numRuns: 500, seed: 3 });
    expect(outlinesSample.every(wellFormed)).toBe(true);
    expect(outlinesSample.filter((o) => o.some((r) => r.children.some((c) => c.children.length > 0))).length).toBeGreaterThan(100);
  });
});

// =============================================================================
// Law 1 with a base: edited outlines read back as edited
// =============================================================================

describe("printing an edited outline with its base", () => {
  type Item = Syntax.OutlineItem;
  const all = (items: readonly Item[]): Item[] => items.flatMap((item) => [item, ...all(item.children)]);
  const rebuild = (items: readonly Item[], f: (item: Item) => Item[]): Item[] =>
    items.flatMap((item) => f({ ...item, children: rebuild(item.children, f) }));

  /** Edits a person makes in an outline: retype, delete, move, or add a row. */
  const edit = (items: readonly Item[], choice: number, kind: number, text: string): Item[] => {
    const flat = all(items).filter((item) => !item.text.startsWith(";"));
    const target = flat[choice % Math.max(1, flat.length)];
    if (!target) return [...items, { id: "added", text, children: [] }];
    switch (kind % 4) {
      case 0:
        return rebuild(items, (item) => (item.id === target.id ? [{ ...item, text }] : [item]));
      case 1:
        return rebuild(items, (item) => (item.id === target.id ? [] : [item]));
      case 2: {
        const without = rebuild(items, (item) => (item.id === target.id ? [] : [item]));
        return [...without, target];
      }
      default:
        return rebuild(items, (item) => (item.id === target.id ? [item, { id: "added", text, children: [] }] : [item]));
    }
  };

  test("read(print(o, base)) = o for edits of a read outline", () => {
    fc.assert(
      fc.property(cleanSource, fc.nat(), fc.nat(), pick("x", "f x", "g [a b]", "h 1 2", "y ; note"), (source, choice, kind, text) => {
        const read = Syntax.sourceToOutline(source);
        const edited = edit(read.items, choice, kind, text);
        const shapes = (items: readonly Item[]) => shape(items);
        fc.pre(wellFormed(shapes(edited)));
        const printed = Syntax.outlineToSource(edited, { base: { source, identity: read.identity } });
        expect(Syntax.identifySyntax(printed.source).errors).toEqual([]);
        const again = Syntax.sourceToOutline(printed.source, { identity: printed.identity });
        expect(shapes(again.items)).toEqual(shapes(edited));
        expect(all(again.items).map((item) => item.id)).toEqual(all(edited).map((item) => item.id));
      }),
      { numRuns: RUNS },
    );
  });
});
