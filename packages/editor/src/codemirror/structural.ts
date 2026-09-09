/**
 * Structural editing keymap for Lisp.
 *
 * Uses the shared language-host AST projection so the editor package does not
 * depend on the old TypeScript language engine's editor subpath.
 */

import { keymap } from "@codemirror/view";
import type { Command, EditorView } from "@codemirror/view";
import { createDefaultLanguageHost } from "@formalang/host/default-host";
import type { AstNode, Span } from "@formalang/host/types";

interface OffsetRange {
  readonly start: number;
  readonly end: number;
}

interface StructuralEditResult {
  readonly source: string;
  readonly selectionStart: number;
  readonly selectionEnd: number;
}

interface NodeRef {
  readonly node: AstNode;
  readonly parentList: AstNode | null;
  readonly container: readonly AstNode[];
  readonly indexInContainer: number;
}

interface ParseContext {
  readonly refs: readonly NodeRef[];
  readonly listRefs: readonly NodeRef[];
}

const structuralLanguageHost = createDefaultLanguageHost();

function getSelectionRange(view: EditorView) {
  const sel = view.state.selection.main;
  return { start: sel.from, end: sel.to };
}

function applyStructuralEdit(view: EditorView, result: StructuralEditResult): boolean {
  view.dispatch({
    changes: { from: 0, to: view.state.doc.length, insert: result.source },
    selection: {
      anchor: result.selectionStart,
      head: result.selectionEnd,
    },
  });
  return true;
}

function clampOffset(offset: number, sourceLength: number): number {
  if (sourceLength <= 0) return 0;
  if (offset < 0) return 0;
  if (offset > sourceLength) return sourceLength;
  return offset;
}

function normalizeRange(start: number, end: number, sourceLength: number): OffsetRange {
  const clampedStart = clampOffset(start, sourceLength);
  const clampedEnd = clampOffset(end, sourceLength);

  return clampedStart <= clampedEnd
    ? { start: clampedStart, end: clampedEnd }
    : { start: clampedEnd, end: clampedStart };
}

function probeOffsetForCursor(offset: number, sourceLength: number): number {
  if (sourceLength <= 0) return 0;
  const clamped = clampOffset(offset, sourceLength);
  if (clamped === sourceLength) return sourceLength - 1;
  return clamped;
}

function spanRange(span: Span): OffsetRange {
  return { start: span.startOffset, end: span.endOffset };
}

function nodeRange(node: AstNode): OffsetRange | null {
  return node.span ? spanRange(node.span) : null;
}

function getNodeChildren(node: AstNode): readonly AstNode[] {
  switch (node.kind) {
    case "list":
    case "vector":
    case "set":
      return node.items;
    case "map":
      return node.entries.flatMap((entry) => [entry.key, entry.value]);
    default:
      return [];
  }
}

function parseContext(source: string): ParseContext | null {
  const parsed = structuralLanguageHost.parseSync({
    sourceId: "structural-edit",
    source,
  });
  if (parsed.diagnostics.some((diagnostic) => diagnostic.severity === "error")) return null;
  if (parsed.ast.some((node) => node.kind === "error")) return null;

  const refs: NodeRef[] = [];
  const listRefs: NodeRef[] = [];

  const visit = (
    node: AstNode,
    parentList: AstNode | null,
    container: readonly AstNode[],
    indexInContainer: number,
  ) => {
    if (!nodeRange(node)) return;
    const ref: NodeRef = { node, parentList, container, indexInContainer };
    refs.push(ref);

    if (node.kind === "list") {
      listRefs.push(ref);
    }

    const childNodes = getNodeChildren(node);
    const childParentList = node.kind === "list" ? node : parentList;

    childNodes.forEach((child, index) => {
      visit(child, childParentList, childNodes, index);
    });
  };

  parsed.ast.forEach((node, index) => {
    visit(node, null, parsed.ast, index);
  });

  return { refs, listRefs };
}

function spanSize(node: AstNode): number {
  const range = nodeRange(node);
  return range ? range.end - range.start : 0;
}

function sanitizeHead(head: string): string {
  const trimmed = head.trim();
  return trimmed.length > 0 ? trimmed : "do";
}

function findSmallestNodeAtOffset(
  context: ParseContext,
  offset: number,
  sourceLength: number,
): NodeRef | null {
  const probe = probeOffsetForCursor(offset, sourceLength);

  const candidates = context.refs.filter((ref) => {
    const range = nodeRange(ref.node);
    return range ? range.start <= probe && probe < range.end : false;
  });

  if (candidates.length === 0) return null;

  return candidates.reduce((smallest, current) =>
    spanSize(current.node) < spanSize(smallest.node) ? current : smallest,
  );
}

function findInnermostListAtOffset(
  context: ParseContext,
  offset: number,
  sourceLength: number,
): NodeRef | null {
  const probe = probeOffsetForCursor(offset, sourceLength);

  const candidates = context.listRefs.filter((ref) => {
    const range = nodeRange(ref.node);
    return range ? range.start <= probe && probe < range.end : false;
  });

  if (candidates.length === 0) return null;

  return candidates.reduce((smallest, current) =>
    spanSize(current.node) < spanSize(smallest.node) ? current : smallest,
  );
}

function resolveTargetRange(
  context: ParseContext,
  sourceLength: number,
  selectionStart: number,
  selectionEnd: number,
): OffsetRange | null {
  const range = normalizeRange(selectionStart, selectionEnd, sourceLength);

  if (range.start === range.end) {
    const target = findSmallestNodeAtOffset(context, range.start, sourceLength);
    if (!target) return null;
    return nodeRange(target.node);
  }

  return range;
}

function selectEnclosingListRange(
  source: string,
  selectionStart: number,
  selectionEnd = selectionStart,
): OffsetRange | null {
  const context = parseContext(source);
  if (!context) return null;

  const range = normalizeRange(selectionStart, selectionEnd, source.length);

  let candidates: NodeRef[];
  if (range.start === range.end) {
    const probe = probeOffsetForCursor(range.start, source.length);
    candidates = context.listRefs.filter((ref) => {
      const refRange = nodeRange(ref.node);
      return refRange ? refRange.start <= probe && probe < refRange.end : false;
    });
  } else {
    candidates = context.listRefs.filter((ref) => {
      const refRange = nodeRange(ref.node);
      return refRange ? refRange.start <= range.start && range.end <= refRange.end : false;
    });
  }

  if (candidates.length === 0) return null;

  candidates = [...candidates].sort((a, b) => spanSize(a.node) - spanSize(b.node));

  const smallest = candidates[0]!;
  const smallestRange = nodeRange(smallest.node);
  if (!smallestRange) return null;
  const matchesSelection = smallestRange.start === range.start && smallestRange.end === range.end;
  const chosen = matchesSelection && candidates.length > 1 ? candidates[1]! : smallest;
  return nodeRange(chosen.node);
}

function wrapSelectionWithHead(
  source: string,
  selectionStart: number,
  selectionEnd: number,
  head: string,
): StructuralEditResult | null {
  const context = parseContext(source);
  if (!context) return null;

  const targetRange = resolveTargetRange(context, source.length, selectionStart, selectionEnd);
  if (!targetRange) return null;

  const formHead = sanitizeHead(head);
  const open = `(${formHead} `;
  const wrapped =
    source.slice(0, targetRange.start) +
    open +
    source.slice(targetRange.start, targetRange.end) +
    ")" +
    source.slice(targetRange.end);

  return {
    source: wrapped,
    selectionStart: targetRange.start + open.length,
    selectionEnd: targetRange.end + open.length,
  };
}

function slurpForwardAtOffset(source: string, offset: number): StructuralEditResult | null {
  const context = parseContext(source);
  if (!context) return null;

  const listRef = findInnermostListAtOffset(context, offset, source.length);
  if (!listRef) return null;

  const sibling = listRef.container[listRef.indexInContainer + 1];
  if (!sibling) return null;

  const siblingRange = nodeRange(sibling);
  const listRange = nodeRange(listRef.node);
  if (!siblingRange || !listRange) return null;

  const movedText = source.slice(siblingRange.start, siblingRange.end);
  if (movedText.length === 0) return null;

  const closeParenOffset = listRange.end - 1;

  let removeStart = siblingRange.start;
  while (removeStart > listRange.end && /\s/.test(source[removeStart - 1] ?? "")) {
    removeStart -= 1;
  }

  const withoutSibling = source.slice(0, removeStart) + source.slice(siblingRange.end);
  const insertedText = ` ${movedText}`;
  const nextSource =
    withoutSibling.slice(0, closeParenOffset) +
    insertedText +
    withoutSibling.slice(closeParenOffset);

  const movedStart = closeParenOffset + 1;

  return {
    source: nextSource,
    selectionStart: movedStart,
    selectionEnd: movedStart + movedText.length,
  };
}

function barfForwardAtOffset(source: string, offset: number): StructuralEditResult | null {
  const context = parseContext(source);
  if (!context) return null;

  const listRef = findInnermostListAtOffset(context, offset, source.length);
  if (!listRef) return null;

  const children = getNodeChildren(listRef.node);
  if (children.length <= 1) return null;

  const previous = children[children.length - 2]!;
  const last = children[children.length - 1]!;

  const previousRange = nodeRange(previous);
  const lastRange = nodeRange(last);
  const listRange = nodeRange(listRef.node);
  if (!previousRange || !lastRange || !listRange) return null;
  const closeParenOffset = listRange.end - 1;

  const movedText = source.slice(lastRange.start, lastRange.end);
  if (movedText.length === 0) return null;

  let removeStart = lastRange.start;
  while (removeStart > previousRange.end && /\s/.test(source[removeStart - 1] ?? "")) {
    removeStart -= 1;
  }

  let removeEnd = lastRange.end;
  while (removeEnd < closeParenOffset && /\s/.test(source[removeEnd] ?? "")) {
    removeEnd += 1;
  }

  const withoutLast = source.slice(0, removeStart) + source.slice(removeEnd);
  const closeParenAfterRemoval = closeParenOffset - (removeEnd - removeStart);

  const insertedText = ` ${movedText}`;
  const nextSource =
    withoutLast.slice(0, closeParenAfterRemoval + 1) +
    insertedText +
    withoutLast.slice(closeParenAfterRemoval + 1);

  const movedStart = closeParenAfterRemoval + 2;

  return {
    source: nextSource,
    selectionStart: movedStart,
    selectionEnd: movedStart + movedText.length,
  };
}

function slurpBackwardAtOffset(source: string, offset: number): StructuralEditResult | null {
  const context = parseContext(source);
  if (!context) return null;

  const listRef = findInnermostListAtOffset(context, offset, source.length);
  if (!listRef) return null;

  const sibling = listRef.container[listRef.indexInContainer - 1];
  if (!sibling) return null;

  const siblingRange = nodeRange(sibling);
  const listRange = nodeRange(listRef.node);
  if (!siblingRange || !listRange) return null;

  const movedText = source.slice(siblingRange.start, siblingRange.end);
  if (movedText.length === 0) return null;

  let removeEnd = siblingRange.end;
  while (removeEnd < listRange.start && /\s/.test(source[removeEnd] ?? "")) {
    removeEnd += 1;
  }

  const withoutSibling = source.slice(0, siblingRange.start) + source.slice(removeEnd);
  const listStartAfterRemoval = listRange.start - (removeEnd - siblingRange.start);

  const insertedText = `${movedText} `;
  const insertOffset = listStartAfterRemoval + 1;
  const nextSource =
    withoutSibling.slice(0, insertOffset) + insertedText + withoutSibling.slice(insertOffset);

  return {
    source: nextSource,
    selectionStart: insertOffset,
    selectionEnd: insertOffset + movedText.length,
  };
}

function barfBackwardAtOffset(source: string, offset: number): StructuralEditResult | null {
  const context = parseContext(source);
  if (!context) return null;

  const listRef = findInnermostListAtOffset(context, offset, source.length);
  if (!listRef) return null;

  const children = getNodeChildren(listRef.node);
  if (children.length <= 1) return null;

  const first = children[0]!;
  const second = children[1]!;

  const firstRange = nodeRange(first);
  const secondRange = nodeRange(second);
  const listRange = nodeRange(listRef.node);
  if (!firstRange || !secondRange || !listRange) return null;
  const openParenOffset = listRange.start;

  const movedText = source.slice(firstRange.start, firstRange.end);
  if (movedText.length === 0) return null;

  let removeStart = firstRange.start;
  while (removeStart > openParenOffset + 1 && /\s/.test(source[removeStart - 1] ?? "")) {
    removeStart -= 1;
  }

  let removeEnd = firstRange.end;
  while (removeEnd < secondRange.start && /\s/.test(source[removeEnd] ?? "")) {
    removeEnd += 1;
  }

  const withoutFirst = source.slice(0, removeStart) + source.slice(removeEnd);
  const insertedText = `${movedText} `;
  const nextSource =
    withoutFirst.slice(0, openParenOffset) + insertedText + withoutFirst.slice(openParenOffset);

  return {
    source: nextSource,
    selectionStart: openParenOffset,
    selectionEnd: openParenOffset + movedText.length,
  };
}

const selectEnclosing: Command = (view) => {
  const source = view.state.doc.toString();
  const { start, end } = getSelectionRange(view);
  const range = selectEnclosingListRange(source, start, end);
  if (!range) return false;

  view.dispatch({
    selection: { anchor: range.start, head: range.end },
  });
  return true;
};

const wrapWithPrompt: Command = (view) => {
  const source = view.state.doc.toString();
  const { start, end } = getSelectionRange(view);
  const head =
    typeof window !== "undefined" ? (window.prompt("Wrap with form head", "do") ?? null) : "do";
  if (head === null) return false;

  const result = wrapSelectionWithHead(source, start, end, head);
  if (!result) return false;
  return applyStructuralEdit(view, result);
};

const wrapWithDo: Command = (view) => {
  const source = view.state.doc.toString();
  const { start, end } = getSelectionRange(view);
  const result = wrapSelectionWithHead(source, start, end, "do");
  if (!result) return false;
  return applyStructuralEdit(view, result);
};

const wrapWithWhen: Command = (view) => {
  const source = view.state.doc.toString();
  const { start, end } = getSelectionRange(view);
  const result = wrapSelectionWithHead(source, start, end, "when");
  if (!result) return false;
  return applyStructuralEdit(view, result);
};

function cursorTransform(
  view: EditorView,
  transform: (source: string, offset: number) => StructuralEditResult | null,
): boolean {
  const source = view.state.doc.toString();
  const offset = view.state.selection.main.head;
  const result = transform(source, offset);
  if (!result) return false;
  return applyStructuralEdit(view, result);
}

const slurpFwd: Command = (view) => cursorTransform(view, slurpForwardAtOffset);
const slurpBwd: Command = (view) => cursorTransform(view, slurpBackwardAtOffset);
const barfFwd: Command = (view) => cursorTransform(view, barfForwardAtOffset);
const barfBwd: Command = (view) => cursorTransform(view, barfBackwardAtOffset);

export const structuralKeymap = keymap.of([
  { key: "Ctrl-Shift-]", run: selectEnclosing },
  { key: "Ctrl-Alt-w", run: wrapWithPrompt },
  { key: "Ctrl-Alt-d", run: wrapWithDo },
  { key: "Ctrl-Alt-m", run: wrapWithWhen },
  { key: "Ctrl-Alt-]", run: slurpFwd },
  { key: "Ctrl-Alt-Shift-[", run: slurpBwd },
  { key: "Ctrl-Alt-[", run: barfFwd },
  { key: "Ctrl-Alt-Shift-]", run: barfBwd },
]);
