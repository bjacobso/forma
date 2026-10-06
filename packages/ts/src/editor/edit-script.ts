/**
 * Id-addressed structural edit scripts.
 *
 * An edit script names nodes by the ids of a syntax identity instead of by
 * offsets, so a person, an outline, or a model can describe a change against
 * a document they saw and have it applied to text that kept its layout. The
 * schema is Effect Schema data and is exported as JSON Schema for structured
 * output. See docs/language-services.md.
 */

import { Result, Schema } from "effect";

import { parse } from "../reader/index.js";
import {
  identifySyntax,
  indexSyntax,
  type SyntaxIdentity,
  type SyntaxIndex,
  type SyntaxNode,
  type SyntaxNodeKind,
  type SyntaxSpan,
  type TextChange,
} from "../syntax/identity.js";
import { joinSource, SourceBuilder } from "../syntax/lexical.js";
import type { DescriptorSource } from "./descriptors.js";
import {
  findReferences,
  indexSymbols,
  kernelNames,
  type SymbolDocument,
  type SymbolIndex,
} from "./symbols.js";

// =============================================================================
// Schema
// =============================================================================

const NodeId = Schema.String.annotate({
  description: "The id of a node in the base document's syntax identity.",
});
const SourceText = Schema.String.annotate({
  description: "Forma source text. It must read without errors.",
});

export const EditPlace = Schema.Union([
  Schema.Struct({ before: NodeId }).annotate({ description: "Immediately before a node." }),
  Schema.Struct({ after: NodeId }).annotate({ description: "Immediately after a node." }),
  Schema.Struct({
    parent: Schema.NullOr(NodeId).annotate({
      description: "The enclosing node, or null for the top level.",
    }),
    index: Schema.optional(
      Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)).annotate({
        description:
          "Position among the parent's children, comments included. Defaults to the end.",
      }),
    ),
  }).annotate({ description: "A position among a parent's children." }),
]).annotate({ identifier: "EditPlace" });
export type EditPlace = typeof EditPlace.Type;

const op = <Name extends string, Fields extends Schema.Struct.Fields>(
  name: Name,
  description: string,
  fields: Fields,
) => Schema.Struct({ op: Schema.Literal(name), ...fields }).annotate({ description });

export const EditOp = Schema.Union([
  op("replace", "Replace a node with new source; a single node of the same kind keeps its id.", {
    target: NodeId,
    text: SourceText,
  }),
  op("insert", "Insert new forms at a place.", { at: EditPlace, text: SourceText }),
  op("delete", "Delete a node, with a comment trailing it on the same line.", { target: NodeId }),
  op("wrap", "Wrap consecutive sibling nodes in a new list that starts with `head`.", {
    targets: Schema.Array(NodeId).check(Schema.isMinLength(1)),
    head: Schema.String.annotate({ description: "Source for the new list's leading elements." }),
  }),
  op("splice", "Remove a list's delimiters, keeping all of its elements in place.", {
    target: NodeId,
  }),
  op("unwrap", "Replace a list with its elements after its head.", { target: NodeId }),
  op("raise", "Replace a node's parent with the node.", { target: NodeId }),
  op("move", "Move a node to a place.", { target: NodeId, to: EditPlace }),
  op("rename", "Rename a binding and every reference to it, refusing captures.", {
    target: NodeId,
    to: Schema.String.annotate({ description: "The new name; a single symbol." }),
  }),
  op(
    "extract",
    "Move a form into a new definition before its top-level form, with its free locals as parameters, and call it in place.",
    { target: NodeId, name: Schema.String },
  ),
]).annotate({ identifier: "EditOp" });
export type EditOp = typeof EditOp.Type;

export const EditScript = Schema.Struct({
  version: Schema.Literal(1),
  description: Schema.optional(Schema.String),
  ops: Schema.Array(EditOp),
}).annotate({
  identifier: "EditScript",
  description:
    "Structural edits addressed by node ids. Operations apply in order; every id refers to the base document and stays valid until an operation removes it.",
});
export type EditScript = typeof EditScript.Type;

/** The edit-script contract as JSON Schema (draft 2020-12), for structured output. */
export function editScriptJsonSchema(): unknown {
  return Schema.toJsonSchemaDocument(EditScript);
}

export interface EditScriptError {
  /** Index of the failing operation, or -1 for a malformed script. */
  readonly op: number;
  readonly code: string;
  readonly message: string;
}

export type DecodedEditScript =
  | { readonly ok: true; readonly script: EditScript }
  | { readonly ok: false; readonly errors: readonly EditScriptError[] };

/** Validate unknown input, such as a model's structured output, as an edit script. */
export function decodeEditScript(input: unknown): DecodedEditScript {
  const decoded = Schema.decodeUnknownResult(EditScript)(input, { onExcessProperty: "error" });
  if (Result.isSuccess(decoded)) return { ok: true, script: decoded.success };
  return {
    ok: false,
    errors: [{ op: -1, code: "edit-script/invalid", message: decoded.failure.message }],
  };
}

// =============================================================================
// Context for a model or a preview
// =============================================================================

export interface NodeDescription {
  readonly id: string;
  readonly kind: SyntaxNode["kind"];
  readonly text: string;
  readonly parent: string | null;
  /** The leading symbol of a list, such as `define`. */
  readonly head?: string | undefined;
  /** Ids from the top-level form down to the parent. */
  readonly path: readonly string[];
  readonly topLevel: { readonly id: string; readonly text: string };
}

/** Describe nodes with the handles an edit script must use. Unknown ids are skipped. */
export function describeNodes(
  source: string,
  identity: SyntaxIdentity,
  ids: readonly string[],
): readonly NodeDescription[] {
  const index = indexSyntax(identity);
  return ids.flatMap((id) => {
    const node = index.node(id);
    if (!node) return [];
    const ancestors = index.ancestors(id);
    const top = ancestors.at(-1) ?? node;
    const head = headSymbol(source, index, node);
    return [
      {
        id,
        kind: node.kind,
        text: textOf(source, node.span),
        parent: node.parent,
        ...(head ? { head } : {}),
        path: ancestors.map((ancestor) => ancestor.id).reverse(),
        topLevel: { id: top.id, text: textOf(source, top.span) },
      },
    ];
  });
}

// =============================================================================
// Application
// =============================================================================

export interface ApplyEditScriptRequest {
  readonly source: string;
  /** Ids the script refers to. A fresh identity is used when omitted. */
  readonly identity?: SyntaxIdentity | undefined;
  readonly script: unknown;
  /** Documents loaded before this one, for rename and extract resolution. */
  readonly documents?: readonly SymbolDocument[] | undefined;
  readonly descriptors?: DescriptorSource | undefined;
  /** Source id of this document among `documents`. Defaults to `"source"`. */
  readonly sourceId?: string | undefined;
}

export interface EditChanges {
  readonly added: readonly string[];
  readonly removed: readonly string[];
  /** Nodes whose parent changed. */
  readonly moved: readonly string[];
  /** Nodes whose text changed. */
  readonly edited: readonly string[];
}

/** A top-level form whose text changed, for a preview. */
export interface AffectedForm {
  readonly id: string;
  readonly before?: string | undefined;
  readonly after?: string | undefined;
}

export type ApplyEditScriptResult =
  | {
      readonly ok: true;
      readonly source: string;
      readonly identity: SyntaxIdentity;
      readonly changes: EditChanges;
      readonly forms: readonly AffectedForm[];
    }
  | { readonly ok: false; readonly errors: readonly EditScriptError[] };

class EditFailure extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

/**
 * Apply an edit script. It applies completely or not at all; errors name the
 * operation that failed.
 */
export function applyEditScript(request: ApplyEditScriptRequest): ApplyEditScriptResult {
  const decoded = decodeEditScript(request.script);
  if (!decoded.ok) return decoded;
  const baseIdentity = request.identity ?? identifySyntax(request.source);
  const known = new Set(baseIdentity.nodes.map((node) => node.id));
  for (const [position, operation] of decoded.script.ops.entries()) {
    const missing = referencedIds(operation).find((id) => !known.has(id));
    if (missing !== undefined) {
      return {
        ok: false,
        errors: [{ op: position, code: "edit/unknown-node", message: `No node with id ${missing}` }],
      };
    }
  }
  let state: DocumentState = { source: request.source, identity: baseIdentity };
  const context: OpContext = {
    sourceId: request.sourceId ?? "source",
    documents: request.documents ?? [],
    descriptors: request.descriptors,
  };
  for (const [position, operation] of decoded.script.ops.entries()) {
    try {
      state = applyOp(state, operation, context);
    } catch (error) {
      if (error instanceof EditFailure) {
        return { ok: false, errors: [{ op: position, code: error.code, message: error.message }] };
      }
      throw error;
    }
  }
  return {
    ok: true,
    source: state.source,
    identity: state.identity,
    ...summarize(request.source, baseIdentity, state.source, state.identity),
  };
}

/** Every node id an operation names. */
function referencedIds(operation: EditOp): readonly string[] {
  const placeIds = (place: EditPlace) =>
    "before" in place ? [place.before] : "after" in place ? [place.after] : place.parent === null ? [] : [place.parent];
  switch (operation.op) {
    case "insert":
      return placeIds(operation.at);
    case "wrap":
      return operation.targets;
    case "move":
      return [operation.target, ...placeIds(operation.to)];
    default:
      return [operation.target];
  }
}

interface DocumentState {
  readonly source: string;
  readonly identity: SyntaxIdentity;
}

interface OpContext {
  readonly sourceId: string;
  readonly documents: readonly SymbolDocument[];
  readonly descriptors: DescriptorSource | undefined;
}

// =============================================================================
// The intended tree
// =============================================================================

/**
 * A node of the tree an operation intends. Atoms and comments are compared by
 * their text, reader macros by their prefix, containers by their kind.
 */
interface TreeNode {
  readonly id: string;
  kind: SyntaxNodeKind;
  text: string;
  children: TreeNode[];
}

/**
 * The document as a tree of identified nodes, edited by an operation. Ids of
 * new nodes come from the identity's counter, so they are never reused.
 */
class Tree {
  readonly roots: TreeNode[];
  readonly #byId = new Map<string, { node: TreeNode; parent: TreeNode | null }>();
  readonly #taken: Set<string>;
  /** Containers whose children the operation changed: the grammar is checked on these. */
  readonly #changed = new Set<TreeNode>();
  /** Braces that held forms before the operation; they keep their kind. */
  readonly #filledBraces = new Set<TreeNode>();
  #nextId: number;

  constructor(
    readonly source: string,
    readonly identity: SyntaxIdentity,
  ) {
    const index = indexSyntax(identity);
    const build = (node: SyntaxNode): TreeNode => {
      const built: TreeNode = {
        id: node.id,
        kind: node.kind,
        text: nodeText(source, node),
        children: index.children(node.id).map(build),
      };
      if (isBraces(built.kind) && formsOf(built.children).length > 0) this.#filledBraces.add(built);
      return built;
    };
    this.roots = index.children(null).map(build);
    this.#reindex();
    this.#taken = new Set(identity.nodes.map((node) => node.id));
    this.#nextId = identity.nextId;
  }

  get nextId(): number {
    return this.#nextId;
  }

  node(id: string): TreeNode {
    const entry = this.#byId.get(id);
    if (!entry) throw new EditFailure("edit/unknown-node", `No node with id ${id}`);
    return entry.node;
  }

  parentOf(id: string): TreeNode | null {
    this.node(id);
    return this.#byId.get(id)!.parent;
  }

  childrenOf(parent: TreeNode | null): TreeNode[] {
    return parent === null ? this.roots : parent.children;
  }

  /** Forms read from new source text, with fresh ids. The first may keep `keep`'s id. */
  forms(text: string, keep?: string): TreeNode[] {
    const identity = identifySyntax(text);
    const index = indexSyntax(identity);
    const build = (node: SyntaxNode, id: string): TreeNode => ({
      id,
      kind: node.kind,
      text: nodeText(text, node),
      children: index.children(node.id).map((child) => build(child, this.fresh())),
    });
    return index.children(null).map((node, position) =>
      build(node, position === 0 && keep !== undefined ? keep : this.fresh()),
    );
  }

  fresh(): string {
    let id: string;
    do {
      id = `${this.identity.idPrefix}${this.#nextId++}`;
    } while (this.#taken.has(id));
    this.#taken.add(id);
    return id;
  }

  /** Replace `count` children of `parent` starting at `at` with `nodes`. */
  splice(parent: TreeNode | null, at: number, count: number, nodes: readonly TreeNode[]): void {
    this.childrenOf(parent).splice(at, count, ...nodes);
    if (parent) this.#changed.add(parent);
    this.#reindex();
  }

  /** Remove a node from its parent. */
  remove(id: string): void {
    const parent = this.parentOf(id);
    const siblings = this.childrenOf(parent);
    this.splice(parent, siblings.indexOf(this.node(id)), 1, []);
  }

  /** Check the grammar where the operation changed children. */
  checkGrammar(): void {
    for (const node of this.#changed) {
      if (!this.#byId.has(node.id)) continue;
      const forms = formsOf(node.children);
      // A reader macro has no closing delimiter, so its form comes last;
      // only comments between the prefix and the form are inside it.
      if (node.kind === "ReaderMacro" && (forms.length !== 1 || node.children.at(-1) !== forms[0])) {
        throw new EditFailure(
          "edit/reader-macro-operand",
          "A reader macro must be followed by exactly one form",
        );
      }
      if (isBraces(node.kind)) {
        const kind = braceKind(node.children);
        if (this.#filledBraces.has(node) && kind !== node.kind) {
          throw new EditFailure(
            "edit/brace-kind",
            node.kind === "Map"
              ? "The edit would turn a map into a set"
              : "The edit would turn a set into a map",
          );
        }
        node.kind = kind;
        if (kind === "Map" && forms.length % 2 !== 0) {
          throw new EditFailure("edit/map-entry", "A map must hold keys and values in pairs");
        }
      }
    }
  }

  /** Nodes in document order with the index of their parent in the same order. */
  flatten(): { node: TreeNode; parent: number; index: number }[] {
    const result: { node: TreeNode; parent: number; index: number }[] = [];
    const visit = (nodes: readonly TreeNode[], parent: number) => {
      nodes.forEach((node, index) => {
        const position = result.push({ node, parent, index }) - 1;
        visit(node.children, position);
      });
    };
    visit(this.roots, -1);
    return result;
  }

  #reindex(): void {
    this.#byId.clear();
    const visit = (nodes: readonly TreeNode[], parent: TreeNode | null) => {
      for (const node of nodes) {
        this.#byId.set(node.id, { node, parent });
        visit(node.children, node);
      }
    };
    visit(this.roots, null);
  }
}

/** What a node is compared by: an atom's or comment's text, a reader macro's prefix. */
function nodeText(source: string, node: SyntaxNode): string {
  const text = source.slice(node.span.start, node.span.end);
  switch (node.kind) {
    case "List":
    case "Vector":
    case "Map":
    case "Set":
      return "";
    case "ReaderMacro":
      return text.startsWith("~@") ? "~@" : text.slice(0, 1);
    case "Comment":
      // A carriage return before the line break belongs to the line break.
      return text.replace(/\r+$/, "");
    default:
      return text;
  }
}

const isBraces = (kind: SyntaxNodeKind) => kind === "Map" || kind === "Set";

const formsOf = (nodes: readonly TreeNode[]) => nodes.filter((node) => node.kind !== "Comment");

/** How the reader reads braces with these children: a set when every form is a plain symbol. */
function braceKind(children: readonly TreeNode[]): "Map" | "Set" {
  const forms = formsOf(children);
  return forms.length > 0 && forms.every((form) => form.kind === "Symbol" && !form.text.startsWith(":"))
    ? "Set"
    : "Map";
}

// =============================================================================
// Operations
// =============================================================================

function applyOp(state: DocumentState, operation: EditOp, context: OpContext): DocumentState {
  const { source, identity } = state;
  const index = indexSyntax(identity);
  const tree = new Tree(source, identity);
  const changes: TextChange[] = [];
  const doc = new Layout(source, index);
  switch (operation.op) {
    case "replace": {
      const target = doc.node(operation.target);
      const text = checkedText(operation.text, "replace");
      const sameKind = topElements(text).length === 1 && topElements(text)[0]!.kind === target.kind;
      const forms = tree.forms(text, sameKind ? target.id : undefined);
      if (forms.length === 0) throw new EditFailure("edit/empty-text", "Replacement text is empty");
      const parent = tree.parentOf(target.id);
      tree.splice(parent, tree.childrenOf(parent).indexOf(tree.node(target.id)), 1, forms);
      changes.push({ ...target.span, text: doc.place(text, doc.column(target.span.start)).text });
      break;
    }
    case "insert": {
      const text = checkedText(operation.text, "insert");
      const forms = tree.forms(text);
      if (forms.length === 0) throw new EditFailure("edit/empty-text", "Inserted text is empty");
      const place = doc.resolvePlace(operation.at);
      tree.splice(place.parent === null ? null : tree.node(place.parent), place.index, 0, forms);
      changes.push(doc.insertion(place, text));
      break;
    }
    case "delete": {
      const target = doc.node(operation.target);
      const deletion = doc.deletion(target);
      tree.remove(target.id);
      if (deletion.comment) tree.remove(deletion.comment.id);
      changes.push(deletion);
      break;
    }
    case "wrap": {
      const targets = doc.siblings(operation.targets);
      const head = operation.head.trim();
      const headForms = head === "" ? [] : tree.forms(checkedText(head, "wrap"));
      const first = targets[0]!;
      const last = targets.at(-1)!;
      const parent = first.parent === null ? null : tree.node(first.parent);
      tree.splice(parent, first.index, targets.length, [
        { id: tree.fresh(), kind: "List", text: "", children: [...headForms, ...targets.map((target) => tree.node(target.id))] },
      ]);
      const region = { start: first.span.start, end: last.span.end };
      const column = doc.column(region.start);
      const multiline = textOf(source, region).includes("\n");
      const separator = head === "" ? "" : multiline ? `\n${spaces(column + 2)}` : " ";
      const body = doc.reindent(region, head === "" ? 1 : multiline ? 2 : head.length + 2);
      changes.push({
        ...region,
        text: joinSource([`(${head}`, separator, body.text, ")"], { breakColumn: column }),
      });
      break;
    }
    case "splice":
    case "unwrap": {
      const target = doc.node(operation.target);
      const kinds = operation.op === "unwrap" ? ["List"] : ["List", "Vector", "Map", "Set"];
      if (!kinds.includes(target.kind)) {
        throw new EditFailure("edit/not-a-list", `Cannot ${operation.op} a ${target.kind}`);
      }
      const elements = index.children(target.id);
      const kept = operation.op === "unwrap" ? dropHead(elements) : elements;
      const parent = tree.parentOf(target.id);
      tree.splice(
        parent,
        tree.childrenOf(parent).indexOf(tree.node(target.id)),
        1,
        kept.map((element) => tree.node(element.id)),
      );
      if (kept.length === 0) {
        // Only the list goes; a comment after it stays.
        changes.push(doc.deletion(target, false));
        break;
      }
      const region = { start: kept[0]!.span.start, end: kept.at(-1)!.span.end };
      const body = doc.reindent(region, doc.column(target.span.start) - doc.column(region.start));
      changes.push({ ...target.span, text: body.text });
      break;
    }
    case "raise": {
      const target = doc.node(operation.target);
      if (target.kind === "Comment") throw new EditFailure("edit/comment", "Cannot raise a comment");
      if (target.parent === null) {
        throw new EditFailure("edit/top-level", "A top-level node has no parent to replace");
      }
      const parent = doc.node(target.parent);
      const grandparent = tree.parentOf(parent.id);
      tree.splice(
        grandparent,
        tree.childrenOf(grandparent).indexOf(tree.node(parent.id)),
        1,
        [tree.node(target.id)],
      );
      const body = doc.reindent(target.span, doc.column(parent.span.start) - doc.column(target.span.start));
      changes.push({ ...parent.span, text: body.text });
      break;
    }
    case "move": {
      const target = doc.node(operation.target);
      const place = doc.resolvePlace(operation.to);
      if (place.parent === target.id || (place.parent !== null && index.ancestors(place.parent).some((a) => a.id === target.id))) {
        throw new EditFailure("edit/move-into-self", "Cannot move a node into itself");
      }
      const moved = tree.node(target.id);
      const origin = tree.parentOf(target.id);
      const from = tree.childrenOf(origin).indexOf(moved);
      const destination = place.parent === null ? null : tree.node(place.parent);
      const before = place.before && place.before.id !== target.id ? tree.node(place.before.id) : undefined;
      tree.remove(target.id);
      const to = before ? tree.childrenOf(destination).indexOf(before) : tree.childrenOf(destination).length;
      // Moving a node to where it is changes nothing.
      if (place.before?.id === target.id || place.after?.id === target.id || (destination === origin && to === from)) {
        return state;
      }
      tree.splice(destination, to, 0, [moved]);
      changes.push(doc.deletion(target, false), doc.insertion(place, textOf(source, target.span), target));
      break;
    }
    case "rename":
      return rename(state, operation.target, operation.to, context);
    case "extract":
      return extract(state, operation.target, operation.name, context);
  }
  return commit(state, tree, changes);
}

/**
 * Apply text changes and check that the result reads as the intended tree.
 * The new identity gives every node the id the operation gave it.
 */
function commit(state: DocumentState, tree: Tree, changes: readonly TextChange[]): DocumentState {
  tree.checkGrammar();
  const ordered = [...changes].sort((left, right) => left.start - right.start || left.end - right.end);
  for (let i = 1; i < ordered.length; i++) {
    if (ordered[i]!.start < ordered[i - 1]!.end) {
      throw new EditFailure("edit/overlap", "The edit's changes overlap");
    }
  }
  // Every seam goes through the builder, so no piece reads differently next
  // to its neighbors: a comment cannot swallow code and atoms cannot fuse.
  const builder = new SourceBuilder();
  let cursor = 0;
  for (const change of ordered) {
    builder.append(state.source.slice(cursor, change.start));
    builder.append(change.text);
    cursor = change.end;
  }
  builder.append(state.source.slice(cursor));
  const source = builder.text;

  const parsed = identifySyntax(source, { idPrefix: state.identity.idPrefix });
  if (parsed.errors.length > state.identity.errors.length) {
    throw new EditFailure(
      "edit/unreadable",
      `The edit would make the source unreadable: ${parsed.errors[parsed.errors.length - 1]!.message}`,
    );
  }
  const intended = tree.flatten();
  const mismatch = (): string | undefined => {
    if (parsed.nodes.length !== intended.length) {
      return `${parsed.nodes.length} nodes instead of ${intended.length}`;
    }
    const positions = new Map(parsed.nodes.map((node, position) => [node.id, position]));
    for (const [position, node] of parsed.nodes.entries()) {
      const want = intended[position]!;
      const parent = node.parent === null ? -1 : positions.get(node.parent)!;
      if (node.kind !== want.node.kind) return `a ${node.kind} where the edit intends a ${want.node.kind}`;
      if (parent !== want.parent || node.index !== want.index) {
        return `a ${node.kind} in a different place than the edit intends`;
      }
      if (nodeText(source, node) !== want.node.text) {
        return `${JSON.stringify(nodeText(source, node))} where the edit intends ${JSON.stringify(want.node.text)}`;
      }
    }
    return undefined;
  };
  const difference = mismatch();
  if (difference !== undefined) {
    throw new EditFailure("edit/structure", `The edited source would read differently: ${difference}`);
  }
  const ids = intended.map((entry) => entry.node.id);
  const positions = new Map(parsed.nodes.map((node, position) => [node.id, position]));
  const identity: SyntaxIdentity = {
    ...parsed,
    idPrefix: state.identity.idPrefix,
    nextId: Math.max(tree.nextId, state.identity.nextId),
    nodes: parsed.nodes.map((node, position) => ({
      ...node,
      id: ids[position]!,
      parent: node.parent === null ? null : ids[positions.get(node.parent)!]!,
    })),
  };
  return { source, identity };
}
// =============================================================================
// Rename and extract
// =============================================================================

function symbolIndexFor(state: DocumentState, context: OpContext): SymbolIndex {
  return indexSymbols(
    [
      ...context.documents.filter((document) => document.sourceId !== context.sourceId),
      { sourceId: context.sourceId, source: state.source, identity: state.identity },
    ],
    context.descriptors ? { descriptors: context.descriptors } : {},
  );
}

function rename(state: DocumentState, targetId: string, to: string, context: OpContext): DocumentState {
  const doc = new Layout(state.source, indexSyntax(state.identity));
  const target = doc.node(targetId);
  if (target.kind !== "Symbol") throw new EditFailure("edit/not-a-symbol", "Only symbols can be renamed");
  const tokens = topElements(to);
  if (tokens.length !== 1 || tokens[0]!.kind !== "Symbol" || to.trim() !== to || to.startsWith(":")) {
    throw new EditFailure("edit/invalid-name", `"${to}" is not a symbol name`);
  }
  const before = symbolIndexFor(state, context);
  const found = findReferences(before, { sourceId: context.sourceId, nodeId: targetId });
  if (!found.definition) {
    throw new EditFailure(
      "edit/not-a-binding",
      `${textOf(state.source, target.span)} does not refer to a definition in this document`,
    );
  }
  if (found.definition.name === to) return state;
  if (kernelNames().has(to)) throw new EditFailure("edit/name-taken", `${to} is a builtin`);
  if (found.definition.scope === "global" && kernelNames().has(found.definition.name)) {
    throw new EditFailure("edit/capture", `Renaming ${found.definition.name} would lose the global cell's initial kernel value`);
  }
  if (
    found.definition.scope === "global" &&
    before.definitions.some((definition) => definition.scope === "global" && definition.name === to)
  ) {
    throw new EditFailure("edit/name-taken", `${to} is already defined`);
  }
  const sites = found.definitionSites ?? [found.definition];
  const allOccurrences = [...new Map([...sites, ...found.references].map((occurrence) => [
    `${occurrence.sourceId}#${occurrence.nodeId}`, occurrence,
  ])).values()];
  const occurrences = allOccurrences.filter(
    (occurrence) => occurrence.sourceId === context.sourceId,
  );
  const external = allOccurrences.filter(
    (occurrence) => occurrence.sourceId !== context.sourceId,
  );
  if (external.length > 0) {
    throw new EditFailure(
      "edit/external-references",
      `${found.definition.name} is also used in ${external[0]!.sourceId}, which this edit cannot change`,
    );
  }
  const tree = new Tree(state.source, state.identity);
  for (const occurrence of occurrences) {
    const node = tree.node(occurrence.nodeId);
    if (node.kind !== "Symbol") {
      throw new EditFailure("edit/not-a-binding", "A macro-generated binding cannot be renamed through its call");
    }
    node.text = to;
  }
  const next = commit(
    state,
    tree,
    occurrences.map((occurrence) => ({ ...occurrence.span, text: to })),
  );
  // Renaming must not change what any other name refers to.
  const after = symbolIndexFor(next, context);
  // Unhygienic macros may introduce names with no author token to rename.
  // Compare their stable provenance addresses as well as author references.
  const expandedAfter = new Map((after.expandedReferences ?? []).map((reference) => [reference.key, reference.binding]));
  const expandedBefore = before.expandedReferences ?? [];
  if (
    expandedBefore.length !== expandedAfter.size ||
    expandedBefore.some((reference) => expandedAfter.get(reference.key) !== reference.binding)
  ) {
    throw new EditFailure("edit/capture", `Renaming to ${to} would change a reference in the expanded program`);
  }
  const renamed = new Set(occurrences.map((occurrence) => occurrence.nodeId));
  const definitionOf = (index: SymbolIndex) =>
    new Map(
      index.references
        .filter((reference) => reference.sourceId === context.sourceId)
        .map((reference) => [reference.nodeId, reference.definition] as const),
    );
  const nodeOfKey = (index: SymbolIndex) =>
    new Map(index.definitions.map((definition) => [definition.key, definition.nodeId] as const));
  const beforeRefs = definitionOf(before);
  const afterRefs = definitionOf(after);
  const beforeNodes = nodeOfKey(before);
  const afterNodes = nodeOfKey(after);
  for (const [nodeId, definition] of beforeRefs) {
    const was = definition ? beforeNodes.get(definition) : undefined;
    const now = afterRefs.get(nodeId);
    const nowNode = now ? afterNodes.get(now) : undefined;
    if (was !== nowNode && !(renamed.has(nodeId) && nowNode === found.definition.nodeId)) {
      const name = textOf(next.source, indexSyntax(next.identity).node(nodeId)?.span ?? { start: 0, end: 0 });
      throw new EditFailure(
        "edit/capture",
        `Renaming to ${to} would change what ${name} refers to`,
      );
    }
  }
  return next;
}

function extract(state: DocumentState, targetId: string, name: string, context: OpContext): DocumentState {
  const index = indexSyntax(state.identity);
  const doc = new Layout(state.source, index);
  const target = doc.node(targetId);
  if (target.parent === null) {
    throw new EditFailure("edit/top-level", "A top-level form is already a definition's peer");
  }
  if (target.kind === "Comment") throw new EditFailure("edit/comment", "Cannot extract a comment");
  const tokens = topElements(name);
  if (tokens.length !== 1 || tokens[0]!.kind !== "Symbol" || name.trim() !== name || name.startsWith(":")) {
    throw new EditFailure("edit/invalid-name", `"${name}" is not a symbol name`);
  }
  const symbols = symbolIndexFor(state, context);
  if (!symbols.expressionNodeIds?.[context.sourceId]?.includes(targetId)) {
    throw new EditFailure("edit/not-an-expression", "Only an executable expression can be extracted");
  }
  if (
    kernelNames().has(name) ||
    symbols.definitions.some((definition) => definition.scope === "global" && definition.name === name)
  ) {
    throw new EditFailure("edit/name-taken", `${name} is already defined`);
  }
  const inside = new Set(index.subtree(target.id).map((node) => node.id));
  // A binding pattern or a defined name is not an expression.
  if (
    symbols.definitions.some(
      (definition) =>
        inside.has(definition.nodeId) &&
        (definition.formNodeId === undefined || !inside.has(definition.formNodeId)),
    )
  ) {
    throw new EditFailure("edit/not-an-expression", "Only an expression can be extracted");
  }
  const definitions = new Map(symbols.definitions.map((definition) => [definition.key, definition]));
  const parameters: string[] = [];
  const freeBindings = new Map<string, string>();
  const references = (symbols.expandedReferences ?? []).filter((reference) =>
    reference.sourceId === context.sourceId &&
    (reference.nodeId !== undefined && inside.has(reference.nodeId) ||
      reference.callNodeId !== undefined && inside.has(reference.callNodeId)),
  );
  for (const reference of references) {
    if (reference.bindingScope !== "local" ||
      reference.bindingNodeId !== undefined && inside.has(reference.bindingNodeId) ||
      reference.bindingCallNodeId !== undefined && inside.has(reference.bindingCallNodeId)) continue;
    const definition = reference.definition ? definitions.get(reference.definition) : undefined;
    // A binding created around the form by a macro has no author parameter
    // that can be passed at this position. Moving it would lose that scope.
    if (!definition || definition.sourceId !== context.sourceId) {
      throw new EditFailure("edit/capture", `Extracting would lose the macro binding of ${reference.name}`);
    }
    const other = freeBindings.get(reference.name);
    if (other !== undefined && other !== reference.binding) {
      throw new EditFailure("edit/capture", `Extracting would merge distinct bindings of ${reference.name}`);
    }
    freeBindings.set(reference.name, reference.binding);
    if (!parameters.includes(reference.name)) parameters.push(reference.name);
  }
  // The call site must not shadow the new name.
  const shadowing = symbols.definitions.find(
    (definition) =>
      definition.scope === "local" &&
      definition.name === name &&
      definition.scopeNodeId !== undefined &&
      index.ancestors(target.id).some((ancestor) => ancestor.id === definition.scopeNodeId),
  );
  if (shadowing) throw new EditFailure("edit/capture", `A local ${name} is in scope at the form`);

  const top = index.ancestors(target.id).at(-1)!;
  const body = doc.reindent(target.span, 2 - doc.column(target.span.start));
  const signature = [name, ...parameters].join(" ");
  const definitionText = `(define (${signature})\n  ${body.text})`;
  const call = `(${signature})`;
  const topColumn = doc.column(top.span.start);
  const previous = index.children(null)[top.index - 1];
  const separator =
    previous && /\n[ \t]*\n/.test(state.source.slice(previous.span.end, top.span.start)) ? "\n\n" : "\n";
  const tree = new Tree(state.source, state.identity);
  const extracted = tree.node(target.id);
  const parent = tree.parentOf(target.id);
  const callNodes = tree.forms(call);
  tree.splice(parent, tree.childrenOf(parent).indexOf(extracted), 1, callNodes);
  const [definition] = tree.forms(`(define (${signature}))`);
  definition!.children.push(extracted);
  tree.splice(null, tree.roots.indexOf(tree.node(top.id)), 0, [definition!]);
  const next = commit(state, tree, [
    { start: top.span.start, end: top.span.start, text: `${definitionText}${separator}${spaces(topColumn)}` },
    { ...target.span, text: call },
  ]);
  const after = symbolIndexFor(next, context);
  const created = after.definitions.find((site) => site.name === name && site.formNodeId === definition!.id);
  const callHead = callNodes[0]!.children[0]!.id;
  if (!created || !(after.expandedReferences ?? []).some((reference) =>
    reference.nodeId === callHead && reference.binding === created.key,
  )) {
    throw new EditFailure("edit/capture", `The extracted call to ${name} would be captured or discarded`);
  }
  const afterRefs = new Map((after.expandedReferences ?? []).map((reference) => [reference.key, reference]));
  for (const reference of references) {
    const now = afterRefs.get(reference.key);
    const parameter = freeBindings.has(reference.name)
      ? after.definitions.find((site) => site.name === reference.name && site.kind === "parameter" && site.formNodeId === definition!.id)
      : undefined;
    const binding = parameter && freeBindings.get(reference.name) === reference.binding ? parameter.key : reference.binding;
    if (!now || now.binding !== binding) {
      throw new EditFailure("edit/capture", `Extracting would change the binding of ${reference.name}`);
    }
  }
  return next;
}

// =============================================================================
// Layout
// =============================================================================

interface ResolvedPlace {
  readonly parent: string | null;
  /** Position among the parent's children. */
  readonly index: number;
  /** The sibling the text goes before, or `undefined` for the end. */
  readonly before?: SyntaxNode | undefined;
  /** The sibling the text goes after. */
  readonly after?: SyntaxNode | undefined;
}

/**
 * Layout choices for operations: where text goes and how it is indented. It
 * decides only whitespace. Whether the result reads as intended is checked by
 * `commit`, and every seam is made safe by `SourceBuilder`.
 */
class Layout {
  constructor(
    readonly source: string,
    readonly index: SyntaxIndex,
  ) {}

  node(id: string): SyntaxNode {
    const node = this.index.node(id);
    if (!node) throw new EditFailure("edit/unknown-node", `No node with id ${id}`);
    return node;
  }

  lineStart(offset: number): number {
    return this.source.lastIndexOf("\n", offset - 1) + 1;
  }

  column(offset: number): number {
    return offset - this.lineStart(offset);
  }

  /** Whether only whitespace precedes `offset` on its line. */
  startsLine(offset: number): boolean {
    return this.source.slice(this.lineStart(offset), offset).trim() === "";
  }

  /** A comment that follows `node` on the same line, if there is one. */
  trailingComment(node: SyntaxNode): SyntaxNode | undefined {
    const next = this.index.children(node.parent)[node.index + 1];
    return next?.kind === "Comment" && /^[ \t]*$/.test(this.source.slice(node.span.end, next.span.start))
      ? next
      : undefined;
  }

  /** Whether the line containing `offset` ends in a comment. */
  lineEndsInComment(offset: number): boolean {
    const lineEnd = this.source.indexOf("\n", offset);
    const end = lineEnd < 0 ? this.source.length : lineEnd;
    return this.index.identity.nodes.some(
      (node) =>
        node.kind === "Comment" &&
        node.span.start >= this.lineStart(offset) &&
        node.span.end <= end &&
        /^\r?$/.test(this.source.slice(node.span.end, end)),
    );
  }

  siblings(ids: readonly string[]): readonly SyntaxNode[] {
    const nodes = ids.map((id) => this.node(id));
    const parent = nodes[0]!.parent;
    if (nodes.some((node) => node.parent !== parent)) {
      throw new EditFailure("edit/not-siblings", "Targets must share a parent");
    }
    const sorted = [...nodes].sort((left, right) => left.index - right.index);
    const all = this.index.children(parent);
    const from = sorted[0]!.index;
    const to = sorted.at(-1)!.index;
    for (let position = from; position <= to; position++) {
      const node = all[position]!;
      if (!ids.includes(node.id) && node.kind !== "Comment") {
        throw new EditFailure("edit/not-contiguous", "Targets must be consecutive siblings");
      }
    }
    return all.slice(from, to + 1);
  }

  resolvePlace(place: EditPlace): ResolvedPlace {
    if ("before" in place) {
      const node = this.node(place.before);
      const after = this.index.children(node.parent)[node.index - 1];
      return { parent: node.parent, index: node.index, before: node, ...(after ? { after } : {}) };
    }
    if ("after" in place) {
      // A comment trailing the node on its line goes with it.
      const node = this.node(place.after);
      const after = this.trailingComment(node) ?? node;
      const next = this.index.children(node.parent)[after.index + 1];
      return { parent: node.parent, index: after.index + 1, after, ...(next ? { before: next } : {}) };
    }
    if (place.parent !== null) {
      const parent = this.node(place.parent);
      if (!["List", "Vector", "Map", "Set"].includes(parent.kind)) {
        throw new EditFailure("edit/not-a-list", `A ${parent.kind} has no children`);
      }
    }
    const children = this.index.children(place.parent);
    const position = place.index ?? children.length;
    if (position > children.length) {
      throw new EditFailure("edit/bad-index", `Index ${position} is past the end of the parent`);
    }
    const before = children[position];
    const after = position > 0 ? children[position - 1] : undefined;
    return {
      parent: place.parent,
      index: position,
      ...(before ? { before } : {}),
      ...(after ? { after } : {}),
    };
  }

  /** Text with continuation lines shifted by `delta` columns, never inside strings. */
  reindent(span: SyntaxSpan, delta: number): { text: string } {
    const text = textOf(this.source, span);
    const protectedSpans = this.index.identity.nodes
      .filter((node) => node.kind === "String" || node.kind === "Error")
      .filter((node) => node.span.start < span.end && span.start < node.span.end)
      .map((node) => ({ start: node.span.start - span.start, end: node.span.end - span.start }));
    return { text: shiftLines(text, delta, protectedSpans) };
  }

  /** New text laid out at `column`: continuation lines shift with it. */
  place(text: string, column: number): { text: string } {
    return { text: shiftLines(text, column, stringSpans(text)) };
  }

  insertion(place: ResolvedPlace, text: string, moving?: SyntaxNode): TextChange {
    const parentColumn = place.parent === null ? -2 : this.column(this.node(place.parent).span.start);
    // Text taken from the document keeps its layout relative to its first line.
    const laid = (column: number) =>
      moving
        ? this.reindent(moving.span, column - this.column(moving.span.start)).text
        : this.place(text, column).text;
    const endsInComment = topElements(text).at(-1)?.kind === "Comment";
    if (place.before) {
      const anchor = place.before;
      const column = this.column(anchor.span.start);
      const separator = this.startsLine(anchor.span.start) || endsInComment ? `\n${spaces(column)}` : " ";
      return { start: anchor.span.start, end: anchor.span.start, text: `${laid(column)}${separator}` };
    }
    if (place.after) {
      const anchor = place.after;
      const ownLine = this.startsLine(anchor.span.start);
      const column = ownLine ? this.column(anchor.span.start) : parentColumn + 2;
      const comment = anchor.kind === "Comment" ? anchor : this.trailingComment(anchor);
      const at = comment?.span.end ?? anchor.span.end;
      if (ownLine || comment || place.parent === null) {
        return { start: at, end: at, text: `\n${spaces(Math.max(column, 0))}${laid(column)}` };
      }
      return { start: at, end: at, text: ` ${laid(column)}` };
    }
    // An empty parent, or an empty document.
    if (place.parent === null) {
      const at = this.source.length;
      const prefix = this.source.trim() === "" ? "" : "\n";
      return { start: at, end: at, text: `${prefix}${laid(0)}` };
    }
    const parent = this.node(place.parent);
    const at = parent.span.end - 1;
    const opener = this.source[at - 1];
    const prefix = opener === "(" || opener === "[" || opener === "{" ? "" : " ";
    return { start: at, end: at, text: `${prefix}${laid(this.column(at))}` };
  }

  /**
   * Remove a node and the whitespace that separated it, and with
   * `withComment` a comment trailing it on the same line.
   */
  deletion(node: SyntaxNode, withComment = true): TextChange & { comment?: SyntaxNode } {
    const comment = withComment ? this.trailingComment(node) : undefined;
    const end = comment?.span.end ?? node.span.end;
    const removed = (change: TextChange) => (comment ? { ...change, comment } : change);
    const restOfLine = /^[ \t\r]*/.exec(this.source.slice(end))![0];
    const lineEnds = this.source[end + restOfLine.length] === "\n" || end + restOfLine.length === this.source.length;
    if (this.startsLine(node.span.start) && lineEnds) {
      // Remove the whole line, and the line break before it.
      const start = this.lineStart(node.span.start);
      const from = start > 0 ? start - 1 : start;
      const to = start > 0 ? end + restOfLine.length : Math.min(this.source.length, end + restOfLine.length + 1);
      if (start > 0 && this.source[from - 1] === "\r") return removed({ start: from - 1, end: to, text: "" });
      return removed({ start: from, end: to, text: "" });
    }
    const following = /^\s*/.exec(this.source.slice(end))![0];
    const next = this.source[end + following.length];
    if (next !== undefined && next !== ")" && next !== "]" && next !== "}") {
      return removed({ start: node.span.start, end: end + following.length, text: "" });
    }
    const preceding = /\s*$/.exec(this.source.slice(0, node.span.start))![0];
    if (preceding.includes("\n") && this.lineEndsInComment(node.span.start - preceding.length)) {
      // Keep the line break that ends a comment.
      return removed({ start: node.span.start, end, text: "" });
    }
    return removed({ start: node.span.start - preceding.length, end, text: "" });
  }
}

/** Shift continuation lines of `text` by `delta` columns, skipping lines that start inside protected spans. */
function shiftLines(text: string, delta: number, protectedSpans: readonly SyntaxSpan[]): string {
  let result = "";
  let cursor = 0;
  for (let position = text.indexOf("\n"); position >= 0; position = text.indexOf("\n", position + 1)) {
    const lineStart = position + 1;
    if (protectedSpans.some((span) => span.start < lineStart && lineStart < span.end)) continue;
    const indent = /^[ \t]*/.exec(text.slice(lineStart))![0].length;
    const blank = text[lineStart + indent] === "\n" || lineStart + indent >= text.length;
    const by = blank ? 0 : Math.max(delta, -indent);
    if (by === 0) continue;
    result += text.slice(cursor, lineStart);
    if (by > 0) {
      result += spaces(by);
      cursor = lineStart;
    } else {
      cursor = lineStart - by;
    }
  }
  return result + text.slice(cursor);
}

function stringSpans(text: string): readonly SyntaxSpan[] {
  return identifySyntax(text)
    .nodes.filter((node) => node.kind === "String")
    .map((node) => node.span);
}

function topElements(text: string): readonly SyntaxNode[] {
  return identifySyntax(text).nodes.filter((node) => node.parent === null);
}

function checkedText(text: string, operation: string): string {
  const result = parse(text);
  if (result.errors.length > 0) {
    throw new EditFailure(
      "edit/unreadable-text",
      `The ${operation} text does not read: ${result.errors[0]!.message}`,
    );
  }
  return text.trim();
}

function dropHead(elements: readonly SyntaxNode[]): readonly SyntaxNode[] {
  const head = elements.findIndex((element) => element.kind !== "Comment");
  return head < 0 ? [] : elements.slice(head + 1);
}

function headSymbol(source: string, index: SyntaxIndex, node: SyntaxNode): string | undefined {
  if (node.kind !== "List") return undefined;
  const first = index.children(node.id).find((child) => child.kind !== "Comment");
  return first?.kind === "Symbol" ? textOf(source, first.span) : undefined;
}

function textOf(source: string, span: SyntaxSpan): string {
  return source.slice(span.start, span.end);
}

function spaces(count: number): string {
  return " ".repeat(Math.max(0, count));
}

function summarize(
  beforeSource: string,
  before: SyntaxIdentity,
  afterSource: string,
  after: SyntaxIdentity,
): { changes: EditChanges; forms: readonly AffectedForm[] } {
  const old = new Map(before.nodes.map((node) => [node.id, node]));
  const current = new Map(after.nodes.map((node) => [node.id, node]));
  const added = after.nodes.filter((node) => !old.has(node.id)).map((node) => node.id);
  const removed = before.nodes.filter((node) => !current.has(node.id)).map((node) => node.id);
  const moved: string[] = [];
  const edited: string[] = [];
  for (const node of after.nodes) {
    const previous = old.get(node.id);
    if (!previous) continue;
    if (previous.parent !== node.parent) moved.push(node.id);
    if (textOf(beforeSource, previous.span) !== textOf(afterSource, node.span)) edited.push(node.id);
  }
  const touched = new Set([...added, ...moved, ...edited]);
  const afterIndex = indexSyntax(after);
  const forms: AffectedForm[] = [];
  for (const node of after.nodes) {
    if (node.parent !== null) continue;
    const changed =
      touched.has(node.id) || afterIndex.subtree(node.id).some((child) => touched.has(child.id));
    const previous = old.get(node.id);
    const beforeText = previous ? textOf(beforeSource, previous.span) : undefined;
    const afterText = textOf(afterSource, node.span);
    if (changed || beforeText !== afterText) {
      forms.push({ id: node.id, ...(beforeText !== undefined ? { before: beforeText } : {}), after: afterText });
    }
  }
  for (const node of before.nodes) {
    if (node.parent === null && !current.has(node.id)) {
      forms.push({ id: node.id, before: textOf(beforeSource, node.span) });
    }
  }
  return { changes: { added, removed, moved, edited }, forms };
}
