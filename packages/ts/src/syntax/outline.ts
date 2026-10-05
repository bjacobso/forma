/**
 * Outline codec: Forma source as an outline of rows, and back.
 *
 * A row's text holds the leading elements of its list and its children hold
 * the rest, the way indentation-sensitive Lisp (SRFI 119, "wisp") writes it.
 * Row ids are syntax node ids, so the same identity serves both views. The
 * rules are in docs/language-services.md.
 */

import {
  identifySyntax,
  indexSyntax,
  reconcileSyntax,
  type SyntaxIdentity,
  type SyntaxIndex,
  type SyntaxNode,
  type SyntaxSpan,
} from "./identity.js";
import { tokenizeWithTrivia } from "../reader/lexer.js";
import { SourceBuilder } from "./lexical.js";

export interface OutlineItem {
  readonly id: string;
  readonly text: string;
  readonly children: readonly OutlineItem[];
}

export interface OutlineRowError {
  readonly id: string;
  readonly message: string;
}

export interface SourceToOutlineOptions {
  /** Ids for the source. A fresh identity is used when omitted. */
  readonly identity?: SyntaxIdentity | undefined;
}

export interface SourceToOutlineResult {
  readonly items: readonly OutlineItem[];
  readonly identity: SyntaxIdentity;
  /** Parse errors, attributed to the innermost row that contains them. */
  readonly errors: readonly OutlineRowError[];
}

export interface OutlineToSourceOptions {
  /** The source and identity the outline was read from; their layout is reused for unchanged rows. */
  readonly base?: { readonly source: string; readonly identity: SyntaxIdentity } | undefined;
  /**
   * How to print a row whose text does not read. `"verbatim"` (the default)
   * prints it as written. `"comment"` comments the row and its subtree out so
   * the rest of the document still reads.
   */
  readonly brokenRows?: "verbatim" | "comment" | undefined;
  /** Prefix for ids of nodes that are not rows, when there is no base. */
  readonly idPrefix?: string | undefined;
}

export interface OutlineRowSpan {
  readonly id: string;
  /** The span of the row's node in the printed source. */
  readonly span: SyntaxSpan;
}

export interface OutlineToSourceResult {
  readonly source: string;
  /** Identity of the printed source in which every printed row's node has the row's id. */
  readonly identity: SyntaxIdentity;
  readonly rows: readonly OutlineRowSpan[];
  /** Rows whose text does not read on its own. */
  readonly errors: readonly OutlineRowError[];
}

const PREFIX_MARKER = /^(~@|`|'|~)(?:\s+|$)/;

// =============================================================================
// Source → outline
// =============================================================================

interface ReadRow {
  readonly item: OutlineItem;
  /** The node whose children are this row's children (the inner list of a prefixed row). */
  readonly container?: SyntaxNode | undefined;
  /** Ids of the header elements in the row's text. */
  readonly header: readonly string[];
  /** The row's text (without a reader-macro prefix) exactly as it appears in the source. */
  readonly raw: string;
  /** The row's whole node exactly as it appears in the source. */
  readonly full: string;
  /** For a row with children and a text: the text between `(` and the text. */
  readonly lead?: string | undefined;
}

interface Reading {
  readonly items: readonly OutlineItem[];
  readonly rows: ReadonlyMap<string, ReadRow>;
  readonly rowParent: ReadonlyMap<string, string | null>;
}

/** Read a source as an outline. Never fails: broken text becomes rows with errors. */
export function sourceToOutline(
  source: string,
  options: SourceToOutlineOptions = {},
): SourceToOutlineResult {
  const identity = options.identity ?? identifySyntax(source);
  const reading = read(source, identity);
  const index = indexSyntax(identity);
  const errors = identity.errors.map((error): OutlineRowError => {
    const node = index.at(error.span.start) ?? identity.nodes.find((n) => n.parent === null);
    let row: string | undefined;
    for (let current = node; current; current = current.parent ? index.node(current.parent) : undefined) {
      if (reading.rows.has(current.id)) {
        row = current.id;
        break;
      }
    }
    return { id: row ?? identity.nodes[0]?.id ?? "", message: error.message };
  });
  return { items: reading.items, identity, errors: errors.filter((error) => error.id !== "") };
}

function read(source: string, identity: SyntaxIdentity): Reading {
  const index = indexSyntax(identity);
  const lines = lineIndex(source);
  const rows = new Map<string, ReadRow>();
  const rowParent = new Map<string, string | null>();
  const text = (span: SyntaxSpan) => source.slice(span.start, span.end);
  const line = (offset: number) => lines(offset);
  const multiline = (node: SyntaxNode) => line(node.span.start) !== line(node.span.end - 1);
  /** Whether a node reads as a row with children: a list with elements past its opening line. */
  const isOutlinedList = (node: SyntaxNode): boolean => {
    if (!multiline(node)) return false;
    const container = node.kind === "List" ? node : node.kind === "ReaderMacro" ? prefixedList(node) : undefined;
    if (!container) return false;
    const opening = line(node.span.start);
    return index
      .children(container.id)
      .some((element) => line(element.span.start) !== opening || isOutlinedList(element));
  };
  const prefixedList = (node: SyntaxNode): SyntaxNode | undefined => {
    const [inner, ...rest] = index.children(node.id);
    if (rest.length > 0 || inner?.kind !== "List") return undefined;
    // The prefix must be glued to its list: `'(`, not `' ; c\n (`.
    return /^(~@|`|'|~)$/.test(source.slice(node.span.start, inner.span.start)) ? inner : undefined;
  };

  const rowsOf = (elements: readonly SyntaxNode[], parent: string | null): OutlineItem[] => {
    const result: OutlineItem[] = [];
    const comments: { item: { id: string; text: string; children: OutlineItem[] }; column: number }[] = [];
    for (const element of elements) {
      if (element.kind === "Comment") {
        const column = element.span.start - (source.lastIndexOf("\n", element.span.start - 1) + 1);
        const ownLine = source.slice(source.lastIndexOf("\n", element.span.start - 1) + 1, element.span.start).trim() === "";
        while (comments.length > 0 && comments.at(-1)!.column >= column) comments.pop();
        const item = { id: element.id, text: lineText(text(element.span)), children: [] as OutlineItem[] };
        rows.set(element.id, { item, header: [], raw: text(element.span), full: text(element.span) });
        const holder = ownLine ? comments.at(-1) : undefined;
        if (holder) {
          holder.item.children.push(item);
          rowParent.set(element.id, holder.item.id);
        } else {
          comments.length = 0;
          result.push(item);
          rowParent.set(element.id, parent);
        }
        if (ownLine) comments.push({ item, column });
        continue;
      }
      comments.length = 0;
      const item = rowOf(element);
      result.push(item);
      rowParent.set(element.id, parent);
    }
    return result;
  };

  const rowOf = (node: SyntaxNode): OutlineItem => {
    const container = node.kind === "List" ? node : node.kind === "ReaderMacro" ? prefixedList(node) : undefined;
    const elements = container ? index.children(container.id) : [];
    const code = elements.filter((element) => element.kind !== "Comment");
    if (!container || !multiline(node) || code.length < 2 && !elements.some(isOutlinedList)) {
      if (container && node.kind === "List" && code.length >= 2 && !multiline(node)) {
        // `(f x)` is written `f x`.
        const item = { id: node.id, text: text({ start: elements[0]!.span.start, end: elements.at(-1)!.span.end }), children: [] };
        rows.set(node.id, { item, header: elements.map((element) => element.id), raw: item.text, full: text(node.span) });
        return item;
      }
      const item = { id: node.id, text: dedent(source, node.span, index), children: [] };
      rows.set(node.id, { item, header: [], raw: text(node.span), full: text(node.span) });
      return item;
    }
    const opening = line(node.span.start);
    const header: SyntaxNode[] = [];
    for (const element of elements) {
      if (line(element.span.start) !== opening || isOutlinedList(element)) break;
      // A row whose text starts with `;` is a comment, so a comment right
      // after `(` starts the children instead.
      if (element.kind === "Comment" && header.length === 0) break;
      header.push(element);
      if (element.kind === "Comment") break;
    }
    // A header such as `' a` would print as a prefixed list (`'(…)`), so its
    // elements become children instead.
    if (node.kind === "List" && header.length > 0) {
      const candidate = text({ start: header[0]!.span.start, end: header.at(-1)!.span.end });
      if (PREFIX_MARKER.test(candidate) && elements.length > header.length) header.length = 0;
    }
    const rest = elements.slice(header.length);
    if (rest.length === 0 && node.kind === "ReaderMacro") {
      // A prefixed list without children is written as it is: `'(a """…""")`.
      const item = { id: node.id, text: dedent(source, node.span, index), children: [] };
      rows.set(node.id, { item, header: [], raw: text(node.span), full: text(node.span) });
      return item;
    }
    const prefix = node.kind === "ReaderMacro" ? source.slice(node.span.start, container.span.start) : "";
    const headerText =
      header.length === 0
        ? ""
        : dedent(source, { start: header[0]!.span.start, end: header.at(-1)!.span.end }, index, node.span.start);
    const rowText = prefix === "" ? headerText : headerText === "" ? prefix : `${prefix} ${headerText}`;
    const children = rowsOf(rest, node.id);
    const item = { id: node.id, text: lineText(rowText), children };
    const raw = header.length === 0 ? "" : text({ start: header[0]!.span.start, end: header.at(-1)!.span.end });
    const lead = header.length === 0 ? undefined : source.slice(container.span.start + 1, header[0]!.span.start);
    rows.set(node.id, { item, container, header: header.map((element) => element.id), raw, full: text(node.span), lead });
    return item;
  };

  const items = rowsOf(index.children(null), null);
  return { items, rows, rowParent };
}

// =============================================================================
// Outline → source
// =============================================================================

type Predecessor =
  | { readonly kind: "open"; readonly row: string | null }
  | { readonly kind: "row"; readonly id: string }
  | { readonly kind: "header"; readonly row: string };

interface BaseLayout {
  readonly source: string;
  readonly index: SyntaxIndex;
  readonly reading: Reading;
  /** For each row: the text before it and what preceded that text. */
  readonly before: ReadonlyMap<string, { readonly predecessor: Predecessor; readonly text: string }>;
  /** For each list row: the text between its last element and its closing delimiter. */
  readonly closing: ReadonlyMap<
    string,
    { readonly last: string | null; readonly text: string; readonly closed: boolean }
  >;
  readonly trailing: string;
  readonly columns: ReadonlyMap<string, number>;
  /** Where each row's node starts in the base, and its length. */
  readonly offsets: ReadonlyMap<string, number>;
  readonly lengths: ReadonlyMap<string, number>;
}

/** Print an outline as source, one row per line unless a base layout says otherwise. */
export function outlineToSource(
  items: readonly OutlineItem[],
  options: OutlineToSourceOptions = {},
): OutlineToSourceResult {
  const base = options.base ? baseLayout(options.base.source, options.base.identity) : undefined;
  const commentBroken = options.brokenRows === "comment";
  // Every piece goes through the builder, so a comment never runs into what
  // follows it and atoms never fuse, whatever the rows' texts are.
  const out = new SourceBuilder();
  const spans: OutlineRowSpan[] = [];
  const errors: OutlineRowError[] = [];
  let last: Predecessor = { kind: "open", row: null };
  // Rows whose text was re-laid out. The reader tells a row's text from its
  // children by line, so whether a child may share the opening line depends
  // on the text being unchanged.
  const relaid = new Set<string>();

  const separator = (item: OutlineItem, parent: string | null, childColumn: number, parentColumn: number) => {
    const reused = base?.before.get(item.id);
    // The first child of a row stays off the row's opening line unless both
    // it and the row's text read exactly as in the base.
    const opened = last.kind === "row" ? null : last.row;
    const mayShareLine = opened === null || !relaid.has(opened);
    if (
      reused &&
      base!.reading.rowParent.get(item.id) === parent &&
      samePredecessor(reused.predecessor, last) &&
      (mayShareLine || reused.text.includes("\n"))
    ) {
      const baseParentColumn = parent === null ? 0 : (base!.columns.get(parent) ?? 0);
      return shiftIndent(reused.text, parentColumn - baseParentColumn);
    }
    if (last.kind === "open" && last.row === null) return "";
    return `\n${" ".repeat(childColumn)}`;
  };

  /** Whether a row and everything under it reads exactly as in the base. */
  const unchanged = (item: OutlineItem): boolean => {
    const original = base?.reading.rows.get(item.id);
    return (
      original !== undefined &&
      original.item.text === item.text &&
      original.item.children.length === item.children.length &&
      original.item.children.every((child, position) => child.id === item.children[position]!.id) &&
      item.children.every(unchanged)
    );
  };

  /**
   * Text for a row at `column`: the base's own text when the row's text is
   * unchanged there and it still has children exactly when it had them (the
   * base's text of a prefixed row leaves out the prefix).
   */
  const layoutText = (item: OutlineItem, text: string, header: string, column: number) => {
    const original = base?.reading.rows.get(item.id);
    if (
      original &&
      original.item.text === text &&
      original.item.children.length > 0 === item.children.length > 0 &&
      base!.columns.get(item.id) === column
    ) {
      return original.raw;
    }
    return indentContinuation(header, column);
  };

  const printComment = (item: OutlineItem, parent: string | null, childColumn: number, parentColumn: number, forced: boolean) => {
    out.append(separator(item, parent, childColumn, parentColumn));
    const original = base?.reading.rows.get(item.id);
    const text =
      original && original.item.text === item.text && original.item.children.length === 0
        ? original.raw
        : content(item.text);
    const commented = forced && !text.startsWith(";") ? commentOut(text) : text;
    const own = out.column;
    const start = out.append(indentContinuation(commented, own));
    spans.push({ id: item.id, span: { start, end: start + firstLine(commented).length } });
    last = { kind: "row", id: item.id };
    for (const child of item.children) {
      printComment(child, item.id, own + 2, own, true);
    }
  };

  const printRow = (item: OutlineItem, parent: string | null, childColumn: number, parentColumn: number): void => {
    const text = content(item.text);
    if (text.startsWith(";")) {
      printComment(item, parent, childColumn, parentColumn, false);
      return;
    }
    const parsed = identifySyntax(text);
    if (parsed.errors.length > 0) {
      errors.push({ id: item.id, message: parsed.errors[0]!.message });
      if (commentBroken) {
        printComment({ ...item, text: commentOut(text) }, parent, childColumn, parentColumn, true);
        return;
      }
    }
    const marker = item.children.length > 0 ? PREFIX_MARKER.exec(text) : null;
    const header = marker ? text.slice(marker[0].length) : text;
    const elements = identifySyntax(header).nodes.filter((node) => node.parent === null);
    const code = elements.filter((node) => node.kind !== "Comment").length;
    if (item.children.length === 0 && elements.length === 0) return;
    out.append(separator(item, parent, childColumn, parentColumn));
    const rowColumn = out.column;
    const original = base?.reading.rows.get(item.id);
    if (original && unchanged(item) && base!.columns.get(item.id) === rowColumn) {
      // An unchanged row prints as its exact base text, children and all.
      const start = out.append(original.full);
      spans.push({ id: item.id, span: { start, end: start + original.full.length } });
      for (const id of descendantRows(item)) {
        const offset = base!.offsets.get(id)! - base!.offsets.get(item.id)!;
        spans.push({ id, span: { start: start + offset, end: start + offset + base!.lengths.get(id)! } });
      }
      last = { kind: "row", id: item.id };
      return;
    }
    if (item.children.length === 0 && code < 2) {
      // One element is that element.
      const written = layoutText(item, text, text, rowColumn);
      const start = out.append(written);
      spans.push({ id: item.id, span: { start, end: start + written.length } });
      last = { kind: "row", id: item.id };
      return;
    }
    const mark = { builder: out.mark(), spans: spans.length, errors: errors.length, last };
    printList(item, marker?.[1] ?? "", text, header, rowColumn, false);
    if (!base) return;
    // The reader tells a row's text from its children by line, and reused
    // layout can change that (a list whose children moved onto its opening
    // line reads as one row). Check that the row reads back as itself, and
    // otherwise print its own seams the canonical way, which always does.
    const printed = out.text.slice(spans.at(-1)!.span.start);
    const [again, ...more] = sourceToOutline(printed).items;
    const same =
      again !== undefined &&
      more.length === 0 &&
      again.text === lineText(text) &&
      again.children.length === item.children.length &&
      again.children.every((child, position) => child.text === lineText(content(item.children[position]!.text)));
    if (same) return;
    out.rewind(mark.builder);
    spans.length = mark.spans;
    errors.length = mark.errors;
    last = mark.last;
    printList(item, marker?.[1] ?? "", text, header, rowColumn, true);
  };

  /** A row with children, as a list. `canonical` puts its children on their own lines. */
  const printList = (item: OutlineItem, prefix: string, text: string, header: string, rowColumn: number, canonical: boolean) => {
    const original = base?.reading.rows.get(item.id);
    const start = out.append(`${prefix}(`);
    const sameText =
      !canonical && original !== undefined && original.item.text === text && original.item.children.length > 0;
    if (!sameText) relaid.add(item.id);
    else relaid.delete(item.id);
    if (header !== "") {
      out.append(sameText && original.lead !== undefined ? original.lead : "");
      out.append(layoutText(item, text, header, rowColumn));
    }
    last = header === "" ? { kind: "open", row: item.id } : { kind: "header", row: item.id };
    for (const child of item.children) {
      printRow(child, item.id, rowColumn + 2, rowColumn);
    }
    const lastChild = item.children.at(-1)?.id ?? null;
    const closing = canonical ? undefined : base?.closing.get(item.id);
    const reuseClosing = closing !== undefined && closing.last === lastChild;
    if (reuseClosing) {
      out.append(shiftIndent(closing.text, rowColumn - (base!.columns.get(item.id) ?? rowColumn)));
    } else if (out.inComment) {
      // A row whose text ends in a comment closes its list on a new line.
      out.append(`\n${" ".repeat(rowColumn)}`);
    }
    // A list the base left unclosed stays unclosed while its end is unchanged.
    if (!(reuseClosing && !closing.closed)) out.append(")");
    spans.push({ id: item.id, span: { start, end: out.length } });
    last = { kind: "row", id: item.id };
  };

  for (const item of items) printRow(item, null, 0, 0);
  if (base) out.append(base.trailing);

  const source = out.text;
  const anchors = spans.map((row) => ({ id: row.id, span: row.span }));
  const identity = options.base
    ? reconcileSyntax(options.base, source, { anchors })
    : identifySyntax(source, {
        anchors,
        ...(options.idPrefix !== undefined ? { idPrefix: options.idPrefix } : {}),
      });
  return { source, identity, rows: spans, errors };
}

/** A row's text: a carriage return before the line break belongs to the line break. */
function lineText(text: string): string {
  return text.replace(/\r+$/, "");
}

/** Rows under a row, in document order. */
function descendantRows(item: OutlineItem): string[] {
  return item.children.flatMap((child) => [child.id, ...descendantRows(child)]);
}

/** A row's text without the whitespace around its tokens and comments. */
function content(text: string): string {
  const lexemes = tokenizeWithTrivia(text);
  let start: number | undefined;
  let end = 0;
  for (const { token, leadingTrivia } of lexemes) {
    for (const trivia of leadingTrivia) {
      if (trivia.kind !== "line-comment") continue;
      start ??= trivia.loc.start;
      end = trivia.loc.end;
    }
    if (token.type === "eof") break;
    start ??= token.loc.start;
    end = token.loc.end;
  }
  return start === undefined ? "" : text.slice(start, end);
}

function baseLayout(source: string, identity: SyntaxIdentity): BaseLayout {
  const index = indexSyntax(identity);
  const reading = read(source, identity);
  const before = new Map<string, { predecessor: Predecessor; text: string }>();
  const closing = new Map<string, { last: string | null; text: string; closed: boolean }>();
  const columns = new Map<string, number>();
  const offsets = new Map<string, number>();
  const lengths = new Map<string, number>();
  const columnOf = (offset: number) => offset - (source.lastIndexOf("\n", offset - 1) + 1);
  for (const [id] of reading.rows) {
    const node = index.node(id)!;
    columns.set(id, columnOf(node.span.start));
    offsets.set(id, node.span.start);
    lengths.set(id, node.span.end - node.span.start);
    const siblings = index.children(node.parent);
    const previous = siblings[node.index - 1];
    const parentRow = reading.rowParent.get(id) ?? null;
    let predecessor: Predecessor;
    let from: number;
    if (previous) {
      const parentRead = parentRow === null ? undefined : reading.rows.get(parentRow);
      predecessor =
        reading.rows.has(previous.id) && !parentRead?.header.includes(previous.id)
          ? { kind: "row", id: previous.id }
          : { kind: "header", row: parentRow ?? "" };
      from = previous.span.end;
    } else if (node.parent === null) {
      predecessor = { kind: "open", row: null };
      from = 0;
    } else {
      predecessor = { kind: "open", row: parentRow };
      from = index.node(node.parent)!.span.start + 1;
    }
    before.set(id, { predecessor, text: source.slice(from, node.span.start) });
    const row = reading.rows.get(id)!;
    if (row.item.children.length > 0 && row.container) {
      const elements = index.children(row.container.id);
      const lastElement = elements.at(-1)!;
      const closed = /[)\]}]/.test(source[row.container.span.end - 1] ?? "") && row.container.span.end > lastElement.span.end;
      closing.set(id, {
        last: row.item.children.at(-1)?.id ?? null,
        text: source.slice(lastElement.span.end, closed ? row.container.span.end - 1 : row.container.span.end),
        closed,
      });
    }
  }
  const lastTop = index.children(null).at(-1);
  return {
    source,
    index,
    reading,
    before,
    closing,
    trailing: lastTop ? source.slice(lastTop.span.end) : source,
    columns,
    offsets,
    lengths,
  };
}

// =============================================================================
// Helpers
// =============================================================================

function samePredecessor(left: Predecessor, right: Predecessor): boolean {
  switch (left.kind) {
    case "open":
      return right.kind === "open" && right.row === left.row;
    case "row":
      return right.kind === "row" && right.id === left.id;
    case "header":
      return right.kind === "header" && right.row === left.row;
  }
}

function lineIndex(source: string): (offset: number) => number {
  const starts = [0];
  for (let position = 0; position < source.length; position++) {
    if (source.charCodeAt(position) === 10) starts.push(position + 1);
  }
  return (offset) => {
    let low = 0;
    let high = starts.length - 1;
    while (low < high) {
      const middle = (low + high + 1) >> 1;
      if (starts[middle]! <= offset) low = middle;
      else high = middle - 1;
    }
    return low;
  };
}

/** Source text with continuation lines made relative to the column of `columnFrom`. */
function dedent(source: string, span: SyntaxSpan, index: SyntaxIndex, columnFrom = span.start): string {
  const text = source.slice(span.start, span.end);
  if (!text.includes("\n")) return text;
  const column = columnFrom - (source.lastIndexOf("\n", columnFrom - 1) + 1);
  const strings = index.identity.nodes
    .filter((node) => (node.kind === "String" || node.kind === "Error") && node.span.start < span.end && span.start < node.span.end)
    .map((node) => ({ start: node.span.start - span.start, end: node.span.end - span.start }));
  return shiftContinuation(text, -column, strings);
}

/** Shift continuation lines right by `column`, outside string literals. */
function indentContinuation(text: string, column: number): string {
  if (!text.includes("\n") || column === 0) return text;
  const strings = identifySyntax(text)
    .nodes.filter((node) => node.kind === "String" || node.kind === "Error")
    .map((node) => node.span);
  return shiftContinuation(text, column, strings);
}

function shiftContinuation(text: string, delta: number, protectedSpans: readonly SyntaxSpan[]): string {
  let result = "";
  let cursor = 0;
  for (let position = text.indexOf("\n"); position >= 0; position = text.indexOf("\n", position + 1)) {
    const lineStart = position + 1;
    if (protectedSpans.some((span) => span.start < lineStart && lineStart < span.end)) continue;
    const indent = /^[ \t]*/.exec(text.slice(lineStart))![0].length;
    const blank = lineStart + indent >= text.length || text[lineStart + indent] === "\n";
    if (blank) continue;
    result += text.slice(cursor, lineStart);
    if (delta >= 0) {
      result += " ".repeat(delta);
      cursor = lineStart;
    } else {
      cursor = lineStart + Math.min(indent, -delta);
    }
  }
  return result + text.slice(cursor);
}

/** Change the indentation of every line after a newline in `text` by `delta`. */
function shiftIndent(text: string, delta: number): string {
  if (delta === 0 || !text.includes("\n")) return text;
  return text.replace(/\n([ \t]*)(?=[^\n]|$)/g, (_match, indent: string, offset: number) => {
    const isLast = text.indexOf("\n", offset + 1) < 0;
    if (!isLast) return `\n${indent}`;
    return `\n${" ".repeat(Math.max(0, indent.length + delta))}`;
  });
}

function firstLine(text: string): string {
  const newline = text.indexOf("\n");
  return newline < 0 ? text : text.slice(0, newline);
}

function commentOut(text: string): string {
  return text
    .split("\n")
    .map((line) => (line.trim() === "" ? line : `; ${line}`))
    .join("\n");
}
