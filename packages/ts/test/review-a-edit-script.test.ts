import { describe, expect, test } from "vitest";
import fc from "fast-check";

import { Editor, Syntax } from "../src/index.js";
import { runs } from "./support/runs.js";

// =============================================================================
// A tree model of edit-script operations
// =============================================================================

interface Tree {
  kind: Syntax.SyntaxNode["kind"];
  /** Atom or comment text; the prefix of a reader macro. */
  readonly text: string;
  readonly id: string;
  children: Tree[];
}

const treeOf = (source: string, identity = Syntax.identifySyntax(source)): Tree => {
  const index = Syntax.indexSyntax(identity);
  const build = (node: Syntax.SyntaxNode): Tree => {
    const raw = source.slice(node.span.start, node.span.end);
    const text =
      node.kind === "ReaderMacro" ? (raw.startsWith("~@") ? "~@" : raw[0]!) : index.children(node.id).length ? "" : raw;
    return { kind: node.kind, text, id: node.id, children: index.children(node.id).map(build) };
  };
  return { kind: "List", text: "", id: "root", children: index.children(null).map(build) };
};

const newForms = (text: string): Tree[] =>
  treeOf(text.trim(), Syntax.identifySyntax(text.trim(), { idPrefix: "new" })).children;

const canonical = (tree: Tree): string => {
  const inner = () => tree.children.filter((c) => c.kind !== "Comment").map(canonical).join(" ");
  switch (tree.kind) {
    case "List":
      return `(${inner()})`;
    case "Vector":
      return `[${inner()}]`;
    case "Map":
      return `M{${inner()}}`;
    case "Set":
      return `S{${inner()}}`;
    case "ReaderMacro":
      return `${tree.text}${inner()}`;
    default:
      return tree.text;
  }
};

const comments = (tree: Tree): string[] =>
  tree.kind === "Comment" ? [tree.text] : tree.children.flatMap(comments);

/** What the reader would call a brace form with these children. */
const braceKind = (children: readonly Tree[]): "Map" | "Set" => {
  const elements = children.filter((c) => c.kind !== "Comment");
  return elements.length > 0 && elements.every((c) => c.kind === "Symbol" && !c.text.startsWith(":")) ? "Set" : "Map";
};

/**
 * Give brace forms the kind the reader will give them when the base gave no
 * evidence: an empty brace form, or one that was empty before the edit.
 */
const normalize = (tree: Tree, nonEmpty: ReadonlySet<string>): void => {
  if (tree.kind === "Map" || tree.kind === "Set") {
    const elements = tree.children.filter((c) => c.kind !== "Comment");
    if (elements.length === 0) tree.kind = "Map";
    else if (!nonEmpty.has(tree.id)) tree.kind = braceKind(tree.children);
  }
  tree.children.forEach((child) => normalize(child, nonEmpty));
};

const nonEmptyBraces = (tree: Tree): string[] => [
  ...((tree.kind === "Map" || tree.kind === "Set") && tree.children.some((c) => c.kind !== "Comment") ? [tree.id] : []),
  ...tree.children.flatMap(nonEmptyBraces),
];

/** Whether a tree is one the reader can produce, with each brace form keeping its kind. */
const valid = (tree: Tree): boolean => {
  const elements = tree.children.filter((c) => c.kind !== "Comment");
  if (tree.kind === "ReaderMacro" && elements.length !== 1) return false;
  if (tree.kind === "Map" && (braceKind(tree.children) !== "Map" || elements.length % 2 !== 0)) return false;
  if (tree.kind === "Set" && braceKind(tree.children) !== "Set") return false;
  return tree.children.every(valid);
};

const whyInvalid = (tree: Tree): string | undefined => {
  const elements = tree.children.filter((c) => c.kind !== "Comment");
  if (tree.kind === "ReaderMacro" && elements.length !== 1) return "reader-macro";
  if ((tree.kind === "Map" || tree.kind === "Set") && braceKind(tree.children) !== tree.kind) return "flip";
  if (tree.kind === "Map" && elements.length % 2 !== 0) return "parity";
  for (const child of tree.children) {
    const why = whyInvalid(child);
    if (why) return why;
  }
  return undefined;
};

const clone = (tree: Tree): Tree => ({ ...tree, children: tree.children.map(clone) });

const find = (tree: Tree, id: string): { parent: Tree; at: number; node: Tree } | undefined => {
  for (const [at, child] of tree.children.entries()) {
    if (child.id === id) return { parent: tree, at, node: child };
    const nested = find(child, id);
    if (nested) return nested;
  }
  return undefined;
};

type Place = { before: string } | { after: string } | { parent: string | null; index?: number };

/** Resolve a place to a parent and a node to go before (undefined: the end). */
const resolve = (root: Tree, place: Place): { parent: Tree; before: Tree | undefined } => {
  if ("before" in place) {
    const hit = find(root, place.before)!;
    return { parent: hit.parent, before: hit.node };
  }
  if ("after" in place) {
    const hit = find(root, place.after)!;
    return { parent: hit.parent, before: hit.parent.children[hit.at + 1] };
  }
  const parent = place.parent === null ? root : find(root, place.parent)!.node;
  return { parent, before: parent.children[place.index ?? parent.children.length] };
};

const insertAt = (target: { parent: Tree; before: Tree | undefined }, forms: Tree[]) => {
  const at = target.before ? target.parent.children.indexOf(target.before) : target.parent.children.length;
  target.parent.children.splice(at, 0, ...forms);
};

type Op =
  | { op: "replace"; target: string; text: string }
  | { op: "insert"; at: Place; text: string }
  | { op: "delete"; target: string }
  | { op: "wrap"; targets: string[]; head: string }
  | { op: "splice"; target: string }
  | { op: "unwrap"; target: string }
  | { op: "raise"; target: string }
  | { op: "move"; target: string; to: Place };

/**
 * The intended result of one operation: its tree, and the comments it may
 * delete. `undefined` when the operation has no meaning (the implementation
 * may refuse it).
 */
let lastWhy: string | undefined;
const model = (source: string, op: Op): { tree: Tree; deleted: string[] } | undefined => {
  const root = treeOf(source);
  const nonEmpty = new Set(nonEmptyBraces(root));
  const deleted: string[] = [];
  const trailingComment = (node: Tree, parent: Tree) => {
    const identity = Syntax.identifySyntax(source);
    const span = identity.nodes.find((n) => n.id === node.id)!.span;
    const next = parent.children[parent.children.indexOf(node) + 1];
    if (next?.kind !== "Comment") return;
    const nextSpan = identity.nodes.find((n) => n.id === next.id)!.span;
    if (/^[ \t]*$/.test(source.slice(span.end, nextSpan.start))) {
      deleted.push(next.text);
      parent.children.splice(parent.children.indexOf(next), 1);
    }
  };
  switch (op.op) {
    case "replace": {
      const hit = find(root, op.target)!;
      deleted.push(...comments(hit.node));
      hit.parent.children.splice(hit.at, 1, ...newForms(op.text));
      break;
    }
    case "insert":
      insertAt(resolve(root, op.at), newForms(op.text));
      break;
    case "delete": {
      const hit = find(root, op.target)!;
      deleted.push(...comments(hit.node));
      trailingComment(hit.node, hit.parent);
      hit.parent.children.splice(hit.parent.children.indexOf(hit.node), 1);
      break;
    }
    case "wrap": {
      const hits = op.targets.map((id) => find(root, id)!);
      const parent = hits[0]!.parent;
      const from = Math.min(...hits.map((h) => h.at));
      const to = Math.max(...hits.map((h) => h.at));
      const region = parent.children.slice(from, to + 1);
      const list: Tree = { kind: "List", text: "", id: "new", children: [...newForms(op.head), ...region] };
      parent.children.splice(from, to - from + 1, list);
      break;
    }
    case "splice":
    case "unwrap": {
      const hit = find(root, op.target)!;
      let kept = hit.node.children;
      if (op.op === "unwrap") {
        const head = kept.findIndex((c) => c.kind !== "Comment");
        // Comments before the head go with it.
        deleted.push(...(head < 0 ? kept : kept.slice(0, head + 1)).flatMap(comments));
        kept = head < 0 ? [] : kept.slice(head + 1);
      }
      hit.parent.children.splice(hit.at, 1, ...kept);
      break;
    }
    case "raise": {
      const hit = find(root, op.target)!;
      const parentHit = find(root, hit.parent.id);
      if (!parentHit) return undefined;
      deleted.push(...minus(comments(hit.parent), comments(hit.node)));
      parentHit.parent.children.splice(parentHit.at, 1, hit.node);
      break;
    }
    case "move": {
      const hit = find(root, op.target)!;
      const place = resolve(root, op.to);
      if (place.before === hit.node) break;
      hit.parent.children.splice(hit.at, 1);
      insertAt(place, [hit.node]);
      break;
    }
  }
  normalize(root, nonEmpty);
  lastWhy = whyInvalid(root);
  return valid(root) ? { tree: root, deleted } : undefined;
};

const sortedCounts = (items: readonly string[]) => [...items].map((c) => c.trimEnd()).sort();

/** Remove each of `removed` once from `items`. */
const minus = (items: readonly string[], removed: readonly string[]) => {
  const rest = [...items];
  for (const item of removed) {
    const at = rest.indexOf(item);
    if (at >= 0) rest.splice(at, 1);
  }
  return rest;
};

/**
 * Check one operation against the model. Returns a description of the
 * violation, or undefined when the operation was refused or matches.
 */
const violation = (source: string, op: Op): string | undefined => {
  const identity = Syntax.identifySyntax(source);
  const result = Editor.applyEditScript({ source, identity, script: { version: 1, ops: [op] } });
  if (!result.ok) return undefined;
  const reparsed = Syntax.identifySyntax(result.source);
  if (reparsed.errors.length > 0) return `errors: ${reparsed.errors[0]!.message} in ${JSON.stringify(result.source)}`;
  const expected = model(source, op);
  const after = treeOf(result.source, reparsed);
  const atoms = (tree: Tree): string[] =>
    ["Symbol", "String", "Number", "Boolean"].includes(tree.kind) ? [tree.text] : tree.children.flatMap(atoms);
  const extra = "text" in op ? op.text : "head" in op ? op.head : "";
  const allowed = new Set([...atoms(treeOf(source)), ...atoms(treeOf(extra.trim()))]);
  const fused = atoms(after).find((a) => !allowed.has(a));
  if (fused !== undefined) return `fused ${fused} in ${JSON.stringify(result.source)}`;
  if (!expected) return `applied-${lastWhy} a meaningless op: ${JSON.stringify(result.source)}`;
  if (canonical(after) !== canonical(expected.tree)) {
    return `tree ${canonical(after)} !== ${canonical(expected.tree)} in ${JSON.stringify(result.source)}`;
  }
  const added =
    op.op === "insert" || op.op === "replace" ? comments(treeOf(op.text.trim())) : op.op === "wrap" ? comments(treeOf(op.head.trim())) : [];
  const want = sortedCounts([...minus(comments(treeOf(source)), expected.deleted), ...added]);
  const got = sortedCounts(comments(after));
  if (JSON.stringify(want) !== JSON.stringify(got)) {
    return `comments ${JSON.stringify(got)} !== ${JSON.stringify(want)} in ${JSON.stringify(result.source)}`;
  }
  return undefined;
};

// =============================================================================
// Generators
// =============================================================================

const atom = fc.constantFrom("a", "b", "e5", "1", "-", '""', '"s"', ":k", "true", '"""two\nlines"""');
const form: fc.Arbitrary<string> = fc.letrec<{ form: string }>((tie) => ({
  form: fc.oneof(
    { depthSize: "small", withCrossShrink: true },
    atom,
    fc
      .tuple(
        fc.constantFrom("(", "[", "{"),
        fc.array(tie("form"), { maxLength: 4 }),
        fc.constantFrom(" ", "\n  ", " ; why\n  ", "\r\n  ", ""),
        fc.constantFrom("", " ; end\n"),
      )
      .map(([open, items, separator, beforeClose]) => {
        const close = open === "(" ? ")" : open === "[" ? "]" : "}";
        return `${open}${items.join(separator)}${beforeClose}${close}`;
      }),
    fc
      .tuple(fc.constantFrom("'", "`", "~", "~@"), fc.constantFrom("", " ; q\n "), tie("form"))
      .map(([prefix, gap, inner]) => `${prefix}${gap}${inner}`),
    fc.tuple(atom, fc.constantFrom("; note\n", "; crlf\r\n")).map(([text, comment]) => `${comment}${text}`),
  ),
})).form;
const program = fc
  .tuple(fc.array(form, { minLength: 1, maxLength: 4 }), fc.constantFrom("\n", " ", " ; top\n"))
  .map(([forms, separator]) => forms.join(separator))
  .filter((text) => Syntax.identifySyntax(text).errors.length === 0);

const texts = fc.constantFrom(
  "x", "e5", "1", '""', "(g x)", "; note", "x ; note", "y z", ":k 1", "'x", "~@y", "(g\n x)", '"""a\nb"""', "x\r\n; c", "; c\r\nx",
);
const heads = fc.constantFrom("h", "", "h 1");

const withOp = program.chain((text) => {
  const nodes = Syntax.identifySyntax(text).nodes;
  const ids = nodes.map((n) => n.id);
  const id = fc.constantFrom(...ids);
  const containers = nodes.filter((n) => ["List", "Vector", "Map", "Set"].includes(n.kind)).map((n) => n.id);
  const place: fc.Arbitrary<Place> = fc.oneof(
    id.map((before) => ({ before })),
    id.map((after) => ({ after })),
    fc.tuple(fc.constantFrom<string | null>(null, ...containers), fc.option(fc.nat(5), { nil: undefined })).map(
      ([parent, index]) => (index === undefined ? { parent } : { parent, index }),
    ),
  );
  const op: fc.Arbitrary<Op> = fc.oneof(
    fc.record({ op: fc.constant("replace" as const), target: id, text: texts }),
    fc.record({ op: fc.constant("insert" as const), at: place, text: texts }),
    fc.record({ op: fc.constant("delete" as const), target: id }),
    fc
      .tuple(id, fc.nat(2), heads)
      .map(([first, extra, head]) => {
        const node = nodes.find((n) => n.id === first)!;
        const siblings = nodes.filter((n) => n.parent === node.parent && n.index >= node.index && n.index <= node.index + extra);
        return { op: "wrap" as const, targets: siblings.map((n) => n.id), head };
      }),
    fc.record({ op: fc.constant("splice" as const), target: id }),
    fc.record({ op: fc.constant("unwrap" as const), target: id }),
    fc.record({ op: fc.constant("raise" as const), target: id }),
    fc.record({ op: fc.constant("move" as const), target: id, to: place }),
  );
  return fc.tuple(fc.constant(text), op);
});

/** Violation classes already reported as `test.fails` below. */
const knownClass = (op: Op, problem: string): string | undefined => {
  const squash = (t: string) => t.replace(/\s+/g, "");
  const tree = /^tree (.*) !== (.*) in /s.exec(problem);
  if (problem.startsWith("fused") || (tree && squash(tree[1]!) === squash(tree[2]!))) return "atoms fuse";
  if (problem.startsWith("applied-flip")) return "brace kind flips";
  if ((op.op === "replace" || op.op === "wrap") && problem.startsWith("applied-reader-macro")) {
    return "reader-macro comment child";
  }
  if ((op.op === "splice" || op.op === "unwrap") && problem.startsWith("comments")) return "empty splice drops comment";
  return undefined;
};

// =============================================================================
// Pins: current behavior that is correct and not pinned elsewhere
// =============================================================================

const setup = (text: string) => {
  const identity = Syntax.identifySyntax(text);
  const id = (snippet: string, nth = 0) => {
    const node = identity.nodes.filter((c) => text.slice(c.span.start, c.span.end) === snippet)[nth];
    if (!node) throw new Error(`no node ${snippet}`);
    return node.id;
  };
  return { identity, id };
};

const apply = (text: string, ops: (id: (snippet: string, nth?: number) => string) => unknown[]) => {
  const { identity, id } = setup(text);
  return Editor.applyEditScript({ source: text, identity, script: { version: 1, ops: ops(id) } });
};

const applied = (text: string, ops: (id: (snippet: string, nth?: number) => string) => unknown[]) => {
  const result = apply(text, ops);
  if (!result.ok) throw new Error(JSON.stringify(result.errors));
  return result.source;
};

const refusal = (text: string, ops: (id: (snippet: string, nth?: number) => string) => unknown[]) => {
  const result = apply(text, ops);
  return result.ok ? `applied: ${JSON.stringify(result.source)}` : result.errors[0]!.code;
};

/** Atom texts in document order, comments excluded. */
const atomsOf = (source: string) =>
  Syntax.identifySyntax(source)
    .nodes.filter((n) => ["Symbol", "String", "Number", "Boolean"].includes(n.kind))
    .map((n) => source.slice(n.span.start, n.span.end));

const topKinds = (source: string) =>
  Syntax.identifySyntax(source).nodes.filter((n) => n.parent === null).map((n) => n.kind);

describe("review A: pinned edit-script behavior", () => {
  test("issue 1: text placed after a trailing comment starts a new line", () => {
    expect(applied("(a ; c\n)\n(b)", (id) => [{ op: "move", target: id("(b)"), to: { parent: id("(a ; c\n)") } }])).toBe(
      "(a ; c\n  (b)\n)",
    );
    expect(applied("(a ; c\n)", (id) => [{ op: "insert", at: { parent: id("(a ; c\n)") }, text: "x" }])).toBe(
      "(a ; c\n  x\n)",
    );
    // Inserted text that itself ends in a comment is followed by a line break.
    expect(applied("(f a b)", (id) => [{ op: "insert", at: { before: id("b") }, text: "; c" }])).toBe(
      "(f a ; c\n     b)",
    );
    // A CRLF document stays readable (the added break is a bare LF).
    expect(applied("(a ; c\r\n)", (id) => [{ op: "insert", at: { parent: id("(a ; c\r\n)") }, text: "x ; d" }])).toBe(
      "(a ; c\r\n  x ; d\n)",
    );
  });

  test("issue 2: a splice ending in a comment keeps what follows on its own line", () => {
    expect(applied("(f (a ; c\n) d\n)", (id) => [{ op: "splice", target: id("(a ; c\n)") }])).toBe("(f a ; c\n   d\n)");
  });

  test("issue 4: a reader-macro operand can be spliced down to one form, and wrapped", () => {
    expect(applied("(g '(a))", (id) => [{ op: "splice", target: id("(a)") }])).toBe("(g 'a)");
    expect(applied("(f ' ; c\n x)", (id) => [{ op: "wrap", targets: [id("x")], head: "h" }])).toBe("(f ' ; c\n (h x))");
  });

  test("a lone carriage return does not end a comment, in new text or a head", () => {
    expect(applied("(f a b)", (id) => [{ op: "insert", at: { after: id("a") }, text: "; c\rx" }])).toBe(
      "(f a ; c\rx\n     b)",
    );
    // A head that ends in a comment is followed by a line break.
    expect(applied("(f a b)", (id) => [{ op: "wrap", targets: [id("a")], head: "h ; c\r x" }])).toBe(
      "(f (h ; c\r x\n   a) b)",
    );
    expect(applied("(f a\r b)", (id) => [{ op: "delete", target: id("b") }])).toBe("(f a)");
  });

  test("deleting the form after a commented line keeps the comment", () => {
    expect(applied("(a) ; c\n(b)", (id) => [{ op: "delete", target: id("(b)") }])).toBe("(a) ; c");
    expect(applied("(a) ; c\n(b) (d)", (id) => [{ op: "delete", target: id("(b)") }])).toBe("(a) ; c\n(d)");
  });

  test("comments move as nodes", () => {
    expect(applied("(f a ; c\n b)\n(g)", (id) => [{ op: "move", target: id("; c"), to: { parent: id("(g)") } }])).toBe(
      "(f a b)\n(g ; c\n )",
    );
    expect(applied("(f a ; c\n b)\n(g x)", (id) => [{ op: "move", target: id("; c"), to: { before: id("x") } }])).toBe(
      "(f a b)\n(g ; c\n   x)",
    );
  });

  test("unwrap drops comments before the head along with it", () => {
    // Current behavior: the doc says "its elements after its head".
    expect(applied("(f (; c\n g a) b)", (id) => [{ op: "unwrap", target: id("(; c\n g a)") }])).toBe("(f a b)");
  });

  test("ids of the base stay valid after an earlier insertion", () => {
    expect(
      applied("(k a)", (id) => [
        { op: "insert", at: { after: id("a") }, text: "(b c)" },
        { op: "wrap", targets: [id("a")], head: "h" },
      ]),
    ).toBe("(k (h a) (b c))");
  });

  test("rename leaves quoted names alone and follows macro arguments", () => {
    expect(applied("(define (f x) '(x))", (id) => [{ op: "rename", target: id("x"), to: "z" }])).toBe(
      "(define (f z) '(x))",
    );
    expect(refusal("(define (f x) '(x))", (id) => [{ op: "rename", target: id("x", 1), to: "z" }])).toBe(
      "edit/not-a-binding",
    );
    expect(
      applied("(define-macro bind [n v body] `(let [~n ~v] ~body))\n(define (f) (bind x 1 (+ x 1)))", (id) => [
        { op: "rename", target: id("x", 0), to: "z" },
      ]),
    ).toBe("(define-macro bind [n v body] `(let [~n ~v] ~body))\n(define (f) (bind z 1 (+ z 1)))");
    // A global used in a macro template is renamed there too.
    expect(
      applied("(define-macro m [] `(helper 1))\n(define (helper x) x)\n(define (k) (m))", (id) => [
        { op: "rename", target: id("helper", 1), to: "h2" },
      ]),
    ).toBe("(define-macro m [] `(h2 1))\n(define (h2 x) x)\n(define (k) (m))");
  });

  test("rename refuses names a macro binds around the reference, and keeps renamed atoms apart", () => {
    expect(
      refusal("(define-macro with-y [body] `(let [y 1] ~body))\n(define (f x) (with-y (+ x 0)))", (id) => [
        { op: "rename", target: id("x"), to: "y" },
      ]),
    ).toBe("edit/capture");
    // `1x` reads as 1 and x; a renamed e5 is kept apart from the 1 so it does not read as 1e5.
    expect(applied("(define (f x) (+ 1x))", (id) => [{ op: "rename", target: id("x"), to: "e5" }])).toBe(
      "(define (f e5) (+ 1 e5))",
    );
    // Conservative: an unused builtin name is refused too.
    expect(refusal("(define (f x) x)", (id) => [{ op: "rename", target: id("x"), to: "list" }])).toBe("edit/name-taken");
  });

  test("extract accepts a name that is only bound inside the extracted form", () => {
    expect(
      applied("(define (f y) (let [h 1] (+ h y)))", (id) => [
        { op: "extract", target: id("(let [h 1] (+ h y))"), name: "h" },
      ]),
    ).toBe("(define (h y)\n  (let [h 1] (+ h y)))\n(define (f y) (h y))");
  });

  test("no violation outside the known classes (random single operations)", () => {
    fc.assert(
      fc.property(withOp, ([text, op]) => {
        const problem = violation(text, op);
        if (problem !== undefined && knownClass(op, problem) === undefined) {
          expect.fail(`${JSON.stringify(text)} ${JSON.stringify(op)}: ${problem}`);
        }
      }),
      { numRuns: runs(200) },
    );
  });
});

// =============================================================================
// Siblings the patches missed
// =============================================================================

describe("review A: sibling bugs", () => {
  // Hazard: text is spliced without checking that neighbours stay separated,
  // so two atoms that were apart (or apart by a delimiter) read as one.
  test("delete joins the atoms on either side", () => {
    expect(atomsOf(applied("(a(b)c)", (id) => [{ op: "delete", target: id("(b)") }]))).toEqual(["a", "c"]);
  });
  test("deleting a comment that separates two atoms joins them", () => {
    expect(atomsOf(applied("(a; c\nb)", (id) => [{ op: "delete", target: id("; c") }]))).toEqual(["a", "b"]);
  });
  test("splice joins an element to its neighbours", () => {
    expect(atomsOf(applied("(f x(a)y)", (id) => [{ op: "splice", target: id("(a)") }]))).toEqual(["f", "x", "a", "y"]);
    expect(atomsOf(applied("(f 1(e5))", (id) => [{ op: "splice", target: id("(e5)") }]))).toEqual(["f", "1", "e5"]);
  });
  test("unwrap joins elements to its neighbours", () => {
    expect(atomsOf(applied("(f x(g a)y)", (id) => [{ op: "unwrap", target: id("(g a)") }]))).toEqual(["f", "x", "a", "y"]);
  });
  test("raise joins the target to the parent's neighbours", () => {
    expect(atomsOf(applied("(f a(b c)d)", (id) => [{ op: "raise", target: id("b") }]))).toEqual(["f", "a", "b", "d"]);
  });
  test("insert before a node joins the text to its left neighbour", () => {
    expect(atomsOf(applied("(f a(b))", (id) => [{ op: "insert", at: { before: id("(b)") }, text: "c" }]))).toEqual([
      "f", "a", "c", "b",
    ]);
  });
  test("insert after a node joins the text to that node", () => {
    // {after: a} resolves to {before: "s"}, which pads only on the right.
    expect(atomsOf(applied('(f a"s")', (id) => [{ op: "insert", at: { after: id("a") }, text: "c" }]))).toEqual([
      "f", "a", "c", '"s"',
    ]);
  });
  test("replace joins the new text to its neighbours", () => {
    expect(atomsOf(applied("(f a(b))", (id) => [{ op: "replace", target: id("(b)"), text: "c" }]))).toEqual(["f", "a", "c"]);
    expect(atomsOf(applied("(f (a)b)", (id) => [{ op: "replace", target: id("(a)"), text: "c" }]))).toEqual(["f", "c", "b"]);
  });
  test("replacing a comment joins the new text to the atom before it", () => {
    expect(atomsOf(applied("[-; note\n1]", (id) => [{ op: "replace", target: id("; note"), text: "x" }]))).toEqual([
      "-", "x", "1",
    ]);
  });
  test("move joins the atoms it leaves behind", () => {
    expect(atomsOf(applied("(f a(b)c)\n(g)", (id) => [{ op: "move", target: id("(b)"), to: { parent: id("(g)") } }]))).toEqual(
      ["f", "a", "c", "g", "b"],
    );
  });

  // Hazard: `{…}` is a Set when every element is a non-keyword symbol and a
  // Map otherwise, so the reader's parity error does not guard edits.
  test("deleting a map value turns the map into a set", () => {
    expect(refusal("{a 1}", (id) => [{ op: "delete", target: id("1") }])).not.toMatch(/^applied/);
  });
  test("replacing a map value with a symbol turns the map into a set", () => {
    expect(refusal("{a 1}", (id) => [{ op: "replace", target: id("1"), text: "b" }])).not.toMatch(/^applied/);
  });
  test("moving a map value out turns the map into a set", () => {
    expect(refusal("{a 1}\n(g)", (id) => [{ op: "move", target: id("1"), to: { parent: id("(g)") } }])).not.toMatch(
      /^applied/,
    );
  });
  test("raising out of a map value turns the map into a set", () => {
    expect(refusal("{k [a]}", (id) => [{ op: "raise", target: id("a") }])).not.toMatch(/^applied/);
  });
  test("unwrapping a head-only list in a map turns the map into a set", () => {
    expect(refusal("{(g) b}", (id) => [{ op: "unwrap", target: id("(g)") }])).not.toMatch(/^applied/);
  });
  test("wrapping set elements turns the set into a map", () => {
    expect(refusal("{a b c}", (id) => [{ op: "wrap", targets: [id("a"), id("b")], head: "g" }])).not.toMatch(/^applied/);
  });
  test("inserting a keyword entry into a set is refused", () => {
    expect(refusal("{a b}", (id) => [{ op: "insert", at: { after: id("b") }, text: ":k 1" }])).toBe("edit/brace-kind");
  });

  // Hazard: a comment between a reader macro and its operand is a child of
  // the reader macro; replace and wrap only guard the operand itself.
  test("replacing the comment inside a reader macro detaches the operand", () => {
    expect(refusal("(f ' ; c\n x)", (id) => [{ op: "replace", target: id("; c"), text: "y" }])).toBe(
      "edit/reader-macro-operand",
    );
  });
  test("wrapping the comment inside a reader macro detaches the operand", () => {
    expect(refusal("(f ' ; c\n x)", (id) => [{ op: "wrap", targets: [id("; c")], head: "h" }])).toBe(
      "edit/reader-macro-operand",
    );
  });

  // Hazard: splice and unwrap of a list with nothing to keep reuse `delete`,
  // which also removes the comment trailing the list.
  test("splicing an empty list deletes the comment after it", () => {
    expect(applied("(f () ; keep\n b)", (id) => [{ op: "splice", target: id("()") }])).toContain("; keep");
  });
  test("unwrapping a head-only list deletes the comment after it", () => {
    expect(applied("(f (g) ; keep\n b)", (id) => [{ op: "unwrap", target: id("(g)") }])).toContain("; keep");
  });

  // Hazard: extract checks binding sites only; quotation and non-expression
  // positions change meaning when the form becomes a call.
  test.fails("extract inside a quote turns data into a call", () => {
    expect(refusal("(define (f y) '(a y))", (id) => [{ op: "extract", target: id("(a y)"), name: "h" }])).not.toMatch(
      /^applied/,
    );
  });
  test.fails("extract inside a quasiquote moves an unquote out of its template", () => {
    expect(
      refusal("(define-macro m [x] `(+ ~x 1))", (id) => [{ op: "extract", target: id("(+ ~x 1)"), name: "h" }]),
    ).not.toMatch(/^applied/);
  });
  test.fails("extract of a special-form or macro head", () => {
    expect(refusal("(define (f y) (let [a y] a))", (id) => [{ op: "extract", target: id("let"), name: "h" }])).not.toMatch(
      /^applied/,
    );
    expect(
      refusal("(define-macro m [] 1)\n(define (f) (m))", (id) => [{ op: "extract", target: id("m", 1), name: "h" }]),
    ).not.toMatch(/^applied/);
  });

  // Hazard: names inside macro expansions have no author node, so rename and
  // extract do not see references and bindings that expansions introduce.
  test.fails("extract loses a local that a macro binds around the form", () => {
    // `(f)` is 3 before; after the edit `x` is unbound in `h`.
    expect(
      refusal("(define-macro with-x [body] `(let [x 1] ~body))\n(define (f) (with-x (+ x 2)))", (id) => [
        { op: "extract", target: id("(+ x 2)"), name: "h" },
      ]),
    ).not.toMatch(/^applied/);
  });
  test.fails("extract loses a local that a macro expansion refers to", () => {
    // `(f)` is 2 before; after the edit `x` is unbound in `h`.
    expect(
      refusal("(define-macro get-x [] `x)\n(define (f) (let [x 1] (+ (get-x) 1)))", (id) => [
        { op: "extract", target: id("(+ (get-x) 1)"), name: "h" },
      ]),
    ).not.toMatch(/^applied/);
  });
  test.fails("rename lets a local capture a global that a macro expansion uses", () => {
    // `(k)` is 101 before; after the edit `(m)` calls the local `helper`, 1.
    expect(
      refusal(
        "(define-macro m [] `(helper 1))\n(define (helper x) (+ x 100))\n(define (k) (let [x 1] (m)))",
        (id) => [{ op: "rename", target: id("x", 2), to: "helper" }],
      ),
    ).toBe("edit/capture");
  });

  // Hazard: commit carries the whole old subtree of an anchored node, so a
  // replaced node's old children lend their ids to the new children.
  test("a later op can address a child that an earlier replace removed", () => {
    expect(
      refusal("(k (f a) c)", (id) => [
        { op: "replace", target: id("(f a)"), text: "(g b)" },
        { op: "delete", target: id("a") },
      ]),
    ).toBe("edit/unknown-node");
  });

  test("scratch property: single operations keep tokens, comments, and tree shape", () => {
    fc.assert(
      fc.property(withOp, ([text, op]) => {
        const problem = violation(text, op);
        if (problem !== undefined) expect.fail(`${JSON.stringify(text)} ${JSON.stringify(op)}: ${problem}`);
      }),
      { numRuns: runs(300) },
    );
  });
});

// =============================================================================
// The edit contract over random scripts
// =============================================================================

describe("edit scripts preserve their intended tree", () => {
  const ops = (text: string) => {
    const nodes = Syntax.identifySyntax(text).nodes;
    const ids = nodes.map((n) => n.id);
    const id = fc.constantFrom(...ids);
    const containers = nodes.filter((n) => ["List", "Vector", "Map", "Set"].includes(n.kind)).map((n) => n.id);
    const place: fc.Arbitrary<Place> = fc.oneof(
      id.map((before) => ({ before })),
      id.map((after) => ({ after })),
      fc.tuple(fc.constantFrom<string | null>(null, ...containers), fc.option(fc.nat(5), { nil: undefined })).map(
        ([parent, index]) => (index === undefined ? { parent } : { parent, index }),
      ),
    );
    return fc.oneof(
      fc.record({ op: fc.constant("replace" as const), target: id, text: texts }),
      fc.record({ op: fc.constant("insert" as const), at: place, text: texts }),
      fc.record({ op: fc.constant("delete" as const), target: id }),
      fc.record({ op: fc.constant("wrap" as const), targets: id.map((target) => [target]), head: heads }),
      fc.record({ op: fc.constant("splice" as const), target: id }),
      fc.record({ op: fc.constant("unwrap" as const), target: id }),
      fc.record({ op: fc.constant("raise" as const), target: id }),
      fc.record({ op: fc.constant("move" as const), target: id, to: place }),
    );
  };
  const scripts = program.chain((text) => fc.tuple(fc.constant(text), fc.array(ops(text), { minLength: 1, maxLength: 4 })));

  test("a script never fails its own structure check and keeps ids unique and fresh", () => {
    fc.assert(
      fc.property(scripts, ([text, script]) => {
        const identity = Syntax.identifySyntax(text);
        const result = Editor.applyEditScript({ source: text, identity, script: { version: 1, ops: script } });
        if (!result.ok) {
          // A refusal names a rule; the structure check is a safety net that never fires.
          expect(result.errors[0]!.code).not.toBe("edit/structure");
          return;
        }
        expect(Syntax.identifySyntax(result.source).errors).toEqual([]);
        const ids = result.identity.nodes.map((node) => node.id);
        expect(new Set(ids).size).toBe(ids.length);
        expect(result.identity.nextId).toBeGreaterThanOrEqual(identity.nextId);
        const before = new Set(identity.nodes.map((node) => node.id));
        for (const node of result.identity.nodes) {
          if (!before.has(node.id)) expect(Number(node.id.slice(1))).toBeGreaterThanOrEqual(identity.nextId);
        }
        // The identity describes the result: same spans and kinds as a fresh read.
        const fresh = Syntax.identifySyntax(result.source);
        expect(result.identity.nodes.map((node) => [node.kind, node.span])).toEqual(
          fresh.nodes.map((node) => [node.kind, node.span]),
        );
      }),
      { numRuns: runs(300) },
    );
  });

  test("a script is its operations applied one after another", () => {
    fc.assert(
      fc.property(scripts, ([text, script]) => {
        const identity = Syntax.identifySyntax(text);
        const whole = Editor.applyEditScript({ source: text, identity, script: { version: 1, ops: script } });
        let state: { source: string; identity: Syntax.SyntaxIdentity } = { source: text, identity };
        for (const op of script) {
          const step = Editor.applyEditScript({ ...state, script: { version: 1, ops: [op] } });
          if (!step.ok) {
            expect(whole.ok).toBe(false);
            return;
          }
          state = { source: step.source, identity: step.identity };
        }
        expect(whole.ok).toBe(true);
        if (whole.ok) {
          expect(whole.source).toBe(state.source);
          expect(whole.identity).toEqual(state.identity);
        }
      }),
      { numRuns: runs(300) },
    );
  });
});
