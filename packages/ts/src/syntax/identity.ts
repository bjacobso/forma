/**
 * Stable node identity across edits.
 *
 * Every syntax node except the root, and every line comment, gets an opaque
 * id. `reconcileSyntax` carries ids from a previous version of a document to
 * the next one, so editors, outlines, and assistants can address nodes by id
 * while spans shift. See docs/language-services.md for the guarantees.
 */

import {
  isRedToken,
  parse,
  type RedNode,
  type RedToken,
  type SyntaxKind,
} from "../reader/index.js";

export type SyntaxNodeKind = Exclude<SyntaxKind, "Root"> | "Comment";

export interface SyntaxSpan {
  readonly start: number;
  readonly end: number;
}

/** One identified element of a document, in document order. */
export interface SyntaxNode {
  readonly id: string;
  readonly kind: SyntaxNodeKind;
  /** The node's text, excluding leading whitespace and comments. */
  readonly span: SyntaxSpan;
  /** The enclosing identified node, or `null` at the top level. */
  readonly parent: string | null;
  /** Position among the parent's identified children, comments included. */
  readonly index: number;
}

export interface SyntaxParseError {
  readonly message: string;
  readonly span: SyntaxSpan;
}

export interface SyntaxIdentity {
  readonly version: 1;
  /** Prefix of generated ids. */
  readonly idPrefix: string;
  /** The number the next generated id will use. Never decreases. */
  readonly nextId: number;
  readonly nodes: readonly SyntaxNode[];
  readonly errors: readonly SyntaxParseError[];
}

/** A text replacement in the previous document's coordinates. */
export interface TextChange {
  readonly start: number;
  readonly end: number;
  readonly text: string;
}

/** Pins the element with exactly this span in the new document to an id. */
export interface SyntaxAnchor {
  readonly id: string;
  readonly span: SyntaxSpan;
}

export interface IdentifyOptions {
  /** Prefix for generated ids. Defaults to `"n"`. */
  readonly idPrefix?: string;
  readonly anchors?: readonly SyntaxAnchor[];
}

export interface ReconcileOptions {
  /**
   * The edits that turned the previous source into the new one. When
   * omitted, the change is the region between the common prefix and suffix.
   */
  readonly changes?: readonly TextChange[];
  readonly anchors?: readonly SyntaxAnchor[];
  /** Ids of nodes the caller removed; they are never given to a new node. */
  readonly retired?: readonly string[];
}

export interface PreviousSyntax {
  readonly source: string;
  readonly identity: SyntaxIdentity;
}

// =============================================================================
// Skeleton: the identified elements of a parse, without ids
// =============================================================================

interface Element {
  readonly kind: SyntaxNodeKind;
  readonly span: SyntaxSpan;
  readonly parent: number;
  readonly index: number;
  readonly children: number[];
  signature: string;
  /** Index just past this element's last descendant. */
  end: number;
}

interface Skeleton {
  readonly elements: readonly Element[];
  readonly errors: readonly SyntaxParseError[];
}

function firstToken(node: RedNode): RedToken | undefined {
  for (const child of node.children()) {
    if (isRedToken(child)) return child;
    const nested = firstToken(child);
    if (nested) return nested;
  }
  return undefined;
}

function skeletonOf(source: string): Skeleton {
  const result = parse(source);
  const elements: Element[] = [];
  const childCount = new Map<number, number>();

  const add = (kind: SyntaxNodeKind, span: SyntaxSpan, parent: number): number => {
    const index = childCount.get(parent) ?? 0;
    childCount.set(parent, index + 1);
    const position = elements.length;
    elements.push({ kind, span, parent, index, children: [], signature: "", end: position + 1 });
    if (parent >= 0) elements[parent]!.children.push(position);
    return position;
  };

  const comments = (token: RedToken | undefined, parent: number): void => {
    if (!token) return;
    for (const trivia of token.leadingTrivia()) {
      if (trivia.kind === "line-comment") {
        const position = add("Comment", { start: trivia.loc.start, end: trivia.loc.end }, parent);
        elements[position]!.signature = signatureOf("Comment", [trivia.text]);
      }
    }
  };

  // Comments in a token's leading trivia belong where the token's element
  // starts. The first token of a node is handled by the node's parent, so
  // they become the node's preceding siblings; comments before a closing
  // delimiter (or the end of input) are the node's last children.
  const visit = (node: RedNode, self: number, ownsFirstTrivia: boolean): void => {
    node.children().forEach((child, position) => {
      const ownsTrivia = position > 0 || ownsFirstTrivia;
      if (isRedToken(child)) {
        if (ownsTrivia) comments(child, self);
        return;
      }
      if (ownsTrivia) comments(firstToken(child), self);
      const kind = child.kind() as SyntaxNodeKind;
      const element = add(kind, child.span(), self);
      visit(child, element, false);
      const created = elements[element]!;
      created.end = elements.length;
      created.signature =
        created.children.length === 0
          ? signatureOf(kind, [atomText(child)])
          : signatureOf(
              kind,
              [atomText(child), ...created.children.map((index) => elements[index]!.signature)],
            );
    });
  };
  visit(result.redTree, -1, true);

  return {
    elements,
    errors: result.errors.map((error) => ({
      message: error.message,
      span: error.loc ? { start: error.loc.start, end: error.loc.end } : { start: 0, end: 0 },
    })),
  };
}

/** The non-delimiter token texts directly inside a node. */
function atomText(node: RedNode): string {
  return node
    .children()
    .filter(isRedToken)
    .map((token) => token.text())
    .join(" ");
}

/** A short structural hash: kind plus token texts, ignoring layout. */
function signatureOf(kind: string, parts: readonly string[]): string {
  let a = 0x811c9dc5;
  let b = 0x01000193;
  const feed = (text: string) => {
    for (let index = 0; index < text.length; index++) {
      const code = text.charCodeAt(index);
      a = Math.imul(a ^ code, 0x01000193) >>> 0;
      b = Math.imul(b ^ code, 0x5bd1e995) >>> 0;
    }
    a = Math.imul(a ^ 0xff, 0x01000193) >>> 0;
    b = Math.imul(b ^ 0xff, 0x5bd1e995) >>> 0;
  };
  feed(kind);
  for (const part of parts) feed(part);
  return `${a.toString(36)}.${b.toString(36)}`;
}

// =============================================================================
// Public API
// =============================================================================

/** Identify every element of a source with fresh ids (and any anchors). */
export function identifySyntax(source: string, options: IdentifyOptions = {}): SyntaxIdentity {
  const idPrefix = options.idPrefix ?? "n";
  const skeleton = skeletonOf(source);
  const ids: (string | undefined)[] = Array.from({ length: skeleton.elements.length });
  const taken = new Set<string>();
  applyAnchors(skeleton, ids, taken, options.anchors ?? [], undefined);
  return finish(skeleton, ids, idPrefix, 1, options.anchors ?? []);
}

/**
 * Identify a new version of a document, carrying ids over from the previous
 * version wherever the matching passes in the design note allow.
 */
export function reconcileSyntax(
  previous: PreviousSyntax,
  source: string,
  options: ReconcileOptions = {},
): SyntaxIdentity {
  const { identity } = previous;
  const before = skeletonOf(previous.source);
  const after = skeletonOf(source);
  const oldIds = idsForSkeleton(before, identity);
  const ids: (string | undefined)[] = Array.from({ length: after.elements.length });
  const taken = new Set<string>();
  const oldMatched = new Set<number>();
  const oldById = new Map<string, number>();
  oldIds.forEach((id, index) => {
    if (id !== undefined) oldById.set(id, index);
  });

  const match = (oldIndex: number, newIndex: number): boolean => {
    const id = oldIds[oldIndex];
    if (id === undefined || oldMatched.has(oldIndex) || ids[newIndex] !== undefined) return false;
    if (taken.has(id)) return false;
    if (matchKind(before.elements[oldIndex]!.kind) !== matchKind(after.elements[newIndex]!.kind)) {
      return false;
    }
    ids[newIndex] = id;
    taken.add(id);
    oldMatched.add(oldIndex);
    return true;
  };
  const matchSubtree = (oldIndex: number, newIndex: number): void => {
    const oldElement = before.elements[oldIndex]!;
    const newElement = after.elements[newIndex]!;
    if (oldElement.end - oldIndex !== newElement.end - newIndex) return;
    for (let offset = 1; offset < oldElement.end - oldIndex; offset++) {
      match(oldIndex + offset, newIndex + offset);
    }
  };

  for (const id of options.retired ?? []) {
    const oldIndex = oldById.get(id);
    if (oldIndex !== undefined) oldMatched.add(oldIndex);
  }

  // Pass 1: anchors. Every explicit anchor is placed before any anchored
  // subtree claims descendants by structure.
  const anchored: [number, number][] = [];
  applyAnchors(after, ids, taken, options.anchors ?? [], (newIndex, id) => {
    const oldIndex = oldById.get(id);
    if (oldIndex === undefined) return;
    oldMatched.add(oldIndex);
    anchored.push([oldIndex, newIndex]);
  });
  for (const [oldIndex, newIndex] of anchored) {
    if (before.elements[oldIndex]!.signature === after.elements[newIndex]!.signature) {
      matchSubtree(oldIndex, newIndex);
    }
  }

  // Pass 2: unchanged positions. Nodes whose text is also unchanged match
  // first; nodes edited in place match after unambiguous moves (pass 3), so
  // a text diff that makes a wrapper look like the wrapped node does not win.
  const changes = options.changes ?? [diffChange(previous.source, source)];
  const mapper = positionMapper(changes);
  const byKey = new Map<string, number>();
  after.elements.forEach((element, index) => {
    byKey.set(`${matchKind(element.kind)}:${element.span.start}:${element.span.end}`, index);
  });
  const edited: [number, number][] = [];
  before.elements.forEach((element, oldIndex) => {
    const start = mapper.start(element.span.start);
    const end = mapper.end(element.span.end);
    if (start === undefined || end === undefined) return;
    const newIndex = byKey.get(`${matchKind(element.kind)}:${start}:${end}`);
    if (newIndex === undefined) return;
    if (element.signature === after.elements[newIndex]!.signature) match(oldIndex, newIndex);
    else edited.push([oldIndex, newIndex]);
  });

  // Pass 3: moved subtrees with an unambiguous signature.
  const unmatchedBySignature = (
    elements: readonly Element[],
    isUnmatched: (index: number) => boolean,
  ): Map<string, number[]> => {
    const groups = new Map<string, number[]>();
    elements.forEach((element, index) => {
      if (!isUnmatched(index)) return;
      const group = groups.get(element.signature);
      if (group) group.push(index);
      else groups.set(element.signature, [index]);
    });
    return groups;
  };
  const oldGroups = unmatchedBySignature(before.elements, (index) => !oldMatched.has(index));
  const newGroups = unmatchedBySignature(after.elements, (index) => ids[index] === undefined);
  after.elements.forEach((element, newIndex) => {
    if (ids[newIndex] !== undefined) return;
    const candidates = newGroups.get(element.signature);
    const olds = oldGroups.get(element.signature);
    if (candidates?.length !== 1 || olds?.length !== 1) return;
    if (match(olds[0]!, newIndex)) matchSubtree(olds[0]!, newIndex);
  });
  for (const [oldIndex, newIndex] of edited) match(oldIndex, newIndex);

  // Pass 4: same kind in the same slot of a matched parent.
  const oldChildren = new Map<string | null, number[]>();
  before.elements.forEach((element, index) => {
    const parent = element.parent < 0 ? null : (oldIds[element.parent] ?? undefined);
    if (parent === undefined) return;
    const list = oldChildren.get(parent) ?? [];
    list[element.index] = index;
    oldChildren.set(parent, list);
  });
  after.elements.forEach((element, newIndex) => {
    if (ids[newIndex] !== undefined) return;
    const parentId = element.parent < 0 ? null : ids[element.parent];
    if (parentId === undefined) return;
    const oldIndex = oldChildren.get(parentId)?.[element.index];
    if (oldIndex !== undefined) match(oldIndex, newIndex);
  });

  return finish(after, ids, identity.idPrefix, identity.nextId, options.anchors ?? []);
}

/** Braces read as a set or a map depending on their contents; edits can flip one into the other. */
function matchKind(kind: SyntaxNodeKind): string {
  return kind === "Set" ? "Map" : kind;
}

function idsForSkeleton(skeleton: Skeleton, identity: SyntaxIdentity): (string | undefined)[] {
  const bySpan = new Map<string, string>();
  for (const node of identity.nodes) {
    bySpan.set(`${node.kind}:${node.span.start}:${node.span.end}`, node.id);
  }
  return skeleton.elements.map((element) =>
    bySpan.get(`${element.kind}:${element.span.start}:${element.span.end}`),
  );
}

function applyAnchors(
  skeleton: Skeleton,
  ids: (string | undefined)[],
  taken: Set<string>,
  anchors: readonly SyntaxAnchor[],
  onAnchor: ((index: number, id: string) => void) | undefined,
): void {
  if (anchors.length === 0) return;
  const bySpan = new Map<string, number>();
  // Outermost wins when two elements share a span.
  for (let index = skeleton.elements.length - 1; index >= 0; index--) {
    const { span } = skeleton.elements[index]!;
    bySpan.set(`${span.start}:${span.end}`, index);
  }
  for (const anchor of anchors) {
    const index = bySpan.get(`${anchor.span.start}:${anchor.span.end}`);
    if (index === undefined || ids[index] !== undefined || taken.has(anchor.id)) continue;
    ids[index] = anchor.id;
    taken.add(anchor.id);
    onAnchor?.(index, anchor.id);
  }
}

function finish(
  skeleton: Skeleton,
  ids: (string | undefined)[],
  idPrefix: string,
  nextId: number,
  anchors: readonly SyntaxAnchor[],
): SyntaxIdentity {
  let next = nextId;
  // Never generate an id that an anchor already uses.
  for (const anchor of anchors) {
    if (!anchor.id.startsWith(idPrefix)) continue;
    const suffix = Number(anchor.id.slice(idPrefix.length));
    if (Number.isSafeInteger(suffix) && suffix >= next) next = suffix + 1;
  }
  const taken = new Set(ids.filter((id): id is string => id !== undefined));
  const nodes: SyntaxNode[] = skeleton.elements.map((element, index) => {
    let id = ids[index];
    if (id === undefined) {
      do {
        id = `${idPrefix}${next++}`;
      } while (taken.has(id));
      ids[index] = id;
      taken.add(id);
    }
    return {
      id,
      kind: element.kind,
      span: element.span,
      parent: element.parent < 0 ? null : ids[element.parent]!,
      index: element.index,
    };
  });
  return { version: 1, idPrefix, nextId: next, nodes, errors: skeleton.errors };
}

// =============================================================================
// Position mapping
// =============================================================================

/** The single change between two texts: everything between their common prefix and suffix. */
export function diffChange(before: string, after: string): TextChange {
  const limit = Math.min(before.length, after.length);
  let prefix = 0;
  while (prefix < limit && before.charCodeAt(prefix) === after.charCodeAt(prefix)) prefix++;
  let suffix = 0;
  while (
    suffix < limit - prefix &&
    before.charCodeAt(before.length - 1 - suffix) === after.charCodeAt(after.length - 1 - suffix)
  ) {
    suffix++;
  }
  return {
    start: prefix,
    end: before.length - suffix,
    text: after.slice(prefix, after.length - suffix),
  };
}

interface PositionMapper {
  /** Where a node starting here starts now, or `undefined` if the edit touched it. */
  start(offset: number): number | undefined;
  /** Where a node ending here ends now, or `undefined` if the edit touched it. */
  end(offset: number): number | undefined;
}

function positionMapper(changes: readonly TextChange[]): PositionMapper {
  const sorted = [...changes].sort((a, b) => a.start - b.start);
  const map = (offset: number, side: "start" | "end"): number | undefined => {
    let delta = 0;
    for (const change of sorted) {
      const shift = change.text.length - (change.end - change.start);
      if (change.start === change.end) {
        // An insertion goes before a node that starts here and after one that ends here.
        if (offset > change.start || (offset === change.start && side === "start")) delta += shift;
        else break;
        continue;
      }
      // A replacement keeps boundaries at its edges: a node retyped in place
      // keeps its start and its end moves with the replacement.
      if (offset <= change.start) break;
      if (offset < change.end) return undefined;
      delta += shift;
    }
    return offset + delta;
  };
  return { start: (offset) => map(offset, "start"), end: (offset) => map(offset, "end") };
}

// =============================================================================
// Lookup helpers
// =============================================================================

export interface SyntaxIndex {
  readonly identity: SyntaxIdentity;
  node(id: string): SyntaxNode | undefined;
  children(id: string | null): readonly SyntaxNode[];
  /** The innermost element whose span contains `offset`. */
  at(offset: number): SyntaxNode | undefined;
  /** The element with exactly this span, outermost first. */
  withSpan(start: number, end: number): SyntaxNode | undefined;
  /** The node and its descendants, in document order. */
  subtree(id: string): readonly SyntaxNode[];
  ancestors(id: string): readonly SyntaxNode[];
}

export function indexSyntax(identity: SyntaxIdentity): SyntaxIndex {
  const byId = new Map<string, SyntaxNode>();
  const positions = new Map<string, number>();
  const children = new Map<string | null, SyntaxNode[]>();
  const bySpan = new Map<string, SyntaxNode>();
  identity.nodes.forEach((node, position) => {
    byId.set(node.id, node);
    positions.set(node.id, position);
    const list = children.get(node.parent);
    if (list) list.push(node);
    else children.set(node.parent, [node]);
    const key = `${node.span.start}:${node.span.end}`;
    if (!bySpan.has(key)) bySpan.set(key, node);
  });
  const subtreeEnd = new Map<string, number>();
  for (let position = identity.nodes.length - 1; position >= 0; position--) {
    const node = identity.nodes[position]!;
    const own = children.get(node.id);
    const last = own?.at(-1);
    subtreeEnd.set(node.id, last ? subtreeEnd.get(last.id)! : position + 1);
  }
  return {
    identity,
    node: (id) => byId.get(id),
    children: (id) => children.get(id) ?? [],
    at: (offset) => {
      let found: SyntaxNode | undefined;
      let level: readonly SyntaxNode[] = children.get(null) ?? [];
      for (;;) {
        const next = level.find((node) => node.span.start <= offset && offset < node.span.end);
        if (!next) return found;
        found = next;
        level = children.get(next.id) ?? [];
      }
    },
    withSpan: (start, end) => bySpan.get(`${start}:${end}`),
    subtree: (id) => {
      const start = positions.get(id);
      if (start === undefined) return [];
      return identity.nodes.slice(start, subtreeEnd.get(id));
    },
    ancestors: (id) => {
      const result: SyntaxNode[] = [];
      let current = byId.get(id)?.parent ?? null;
      while (current !== null) {
        const node = byId.get(current);
        if (!node) break;
        result.push(node);
        current = node.parent;
      }
      return result;
    },
  };
}
