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
  reconcileSyntax,
  type SyntaxAnchor,
  type SyntaxIdentity,
  type SyntaxIndex,
  type SyntaxNode,
  type SyntaxSpan,
  type TextChange,
} from "../syntax/identity.js";
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

/** Replacements in the current document plus the ids to pin in the result. */
interface Plan {
  readonly changes: TextChange[];
  /** Pins a node id to the text at `offset` (relative to change `change`) with `length`. */
  readonly anchors: { id: string; change: number; offset: number; length: number }[];
}

function applyOp(state: DocumentState, operation: EditOp, context: OpContext): DocumentState {
  const { source, identity } = state;
  const index = indexSyntax(identity);
  const plan: Plan = { changes: [], anchors: [] };
  const doc = new Layout(source, index);
  switch (operation.op) {
    case "replace": {
      const target = doc.node(operation.target);
      const text = checkedText(operation.text, "replace");
      const forms = topElements(text);
      if (forms.length === 0) throw new EditFailure("edit/empty-text", "Replacement text is empty");
      if (target.parent !== null && doc.node(target.parent).kind === "ReaderMacro" && (forms.length !== 1 || forms[0]!.kind === "Comment")) {
        throw new EditFailure(
          "edit/reader-macro-operand",
          "The form after a reader macro can only be replaced by one form",
        );
      }
      const replaced = doc.place(text, doc.column(target.span.start));
      const breakAfter = doc.breakAfter(text, target.span.end, doc.column(target.span.start));
      const change = plan.changes.push({ ...target.span, text: `${replaced.text}${breakAfter}` }) - 1;
      if (forms.length === 1 && forms[0]!.kind === target.kind) {
        plan.anchors.push({
          id: target.id,
          change,
          offset: replaced.map(forms[0]!.span.start),
          length: replaced.map(forms[0]!.span.end) - replaced.map(forms[0]!.span.start),
        });
      }
      break;
    }
    case "insert": {
      const text = checkedText(operation.text, "insert");
      if (topElements(text).length === 0) {
        throw new EditFailure("edit/empty-text", "Inserted text is empty");
      }
      plan.changes.push(doc.insertion(doc.resolvePlace(operation.at), text));
      break;
    }
    case "delete":
      plan.changes.push(doc.deletion(doc.detachable(operation.target)));
      break;
    case "wrap": {
      const targets = doc.siblings(operation.targets);
      const head = operation.head.trim();
      if (head !== "") checkedText(head, "wrap");
      if (head !== "" && topElements(head).at(-1)?.kind === "Comment") {
        throw new EditFailure("edit/trailing-comment", "The wrap head must not end with a comment");
      }
      const first = targets[0]!;
      const last = targets.at(-1)!;
      const region = { start: first.span.start, end: last.span.end };
      const regionText = textOf(source, region);
      const column = doc.column(region.start);
      const multiline = regionText.includes("\n");
      const opening = head === "" ? "(" : multiline ? `(${head}\n${spaces(column + 2)}` : `(${head} `;
      const shift = head === "" ? 1 : multiline ? 2 : opening.length;
      const body = doc.reindent(region, shift);
      const closing = last.kind === "Comment" ? `\n${spaces(column)})` : ")";
      const change = plan.changes.push({ ...region, text: `${opening}${body.text}${closing}` }) - 1;
      for (const target of targets) {
        const start = opening.length + body.map(target.span.start - region.start);
        const end = opening.length + body.map(target.span.end - region.start);
        plan.anchors.push({ id: target.id, change, offset: start, length: end - start });
      }
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
      const operand = target.parent !== null && doc.node(target.parent).kind === "ReaderMacro";
      if (operand && kept.filter((element) => element.kind !== "Comment").length !== 1) {
        throw new EditFailure(
          "edit/reader-macro-operand",
          "A reader macro's form can only be spliced down to one form",
        );
      }
      if (kept.length === 0) {
        plan.changes.push(doc.deletion(target));
        break;
      }
      const region = { start: kept[0]!.span.start, end: kept.at(-1)!.span.end };
      const body = doc.reindent(region, doc.column(target.span.start) - doc.column(region.start));
      // Code after the list must not join a line that now ends in a comment.
      const after =
        kept.at(-1)!.kind === "Comment" ? doc.lineBreakAt(target.span.end, doc.column(target.span.start)) : "";
      const change = plan.changes.push({ ...target.span, text: `${body.text}${after}` }) - 1;
      for (const element of kept) {
        const start = body.map(element.span.start - region.start);
        const end = body.map(element.span.end - region.start);
        plan.anchors.push({ id: element.id, change, offset: start, length: end - start });
      }
      break;
    }
    case "raise": {
      const target = doc.node(operation.target);
      if (target.kind === "Comment") throw new EditFailure("edit/comment", "Cannot raise a comment");
      if (target.parent === null) {
        throw new EditFailure("edit/top-level", "A top-level node has no parent to replace");
      }
      const parent = doc.node(target.parent);
      const body = doc.reindent(target.span, doc.column(parent.span.start) - doc.column(target.span.start));
      const change = plan.changes.push({ ...parent.span, text: body.text }) - 1;
      plan.anchors.push({ id: target.id, change, offset: 0, length: body.text.length });
      break;
    }
    case "move": {
      const target = doc.detachable(operation.target);
      const place = doc.resolvePlace(operation.to);
      if (place.parent !== null && index.ancestors(place.parent).some((a) => a.id === target.id)) {
        throw new EditFailure("edit/move-into-self", "Cannot move a node into itself");
      }
      if (place.parent === target.id) {
        throw new EditFailure("edit/move-into-self", "Cannot move a node into itself");
      }
      const deletion = doc.deletion(target, false);
      const insertion = doc.insertion(place, textOf(source, target.span), target);
      if (insertion.start > deletion.start && insertion.start < deletion.end) {
        // Moving next to itself: nothing changes.
        break;
      }
      plan.changes.push(deletion);
      const change = plan.changes.push(insertion) - 1;
      const placed = insertion.placed!;
      plan.anchors.push({ id: target.id, change, offset: placed.start, length: placed.end - placed.start });
      break;
    }
    case "rename":
      return rename(state, operation.target, operation.to, context);
    case "extract":
      return extract(state, operation.target, operation.name, context);
  }
  return commit(state, plan);
}

/** Apply a plan's changes and carry ids through them. */
function commit(state: DocumentState, plan: Plan): DocumentState {
  const ordered = plan.changes
    .map((change, position) => ({ change, position }))
    .sort((left, right) => left.change.start - right.change.start || left.change.end - right.change.end);
  for (let i = 1; i < ordered.length; i++) {
    if (ordered[i]!.change.start < ordered[i - 1]!.change.end) {
      throw new EditFailure("edit/overlap", "The edit's changes overlap");
    }
  }
  let source = "";
  let cursor = 0;
  const newStart = new Map<number, number>();
  for (const { change, position } of ordered) {
    source += state.source.slice(cursor, change.start);
    newStart.set(position, source.length);
    source += change.text;
    cursor = change.end;
  }
  source += state.source.slice(cursor);
  const anchors: SyntaxAnchor[] = plan.anchors.map((anchor) => {
    const start = newStart.get(anchor.change)! + anchor.offset;
    return { id: anchor.id, span: { start, end: start + anchor.length } };
  });
  // Nodes inside replaced text are gone, unless an anchor carries them (with
  // their subtrees) to their new place. Their ids must not reach other nodes.
  const index = indexSyntax(state.identity);
  const carried = new Set(plan.anchors.flatMap((anchor) => index.subtree(anchor.id).map((node) => node.id)));
  const retired = state.identity.nodes
    .filter(
      (node) =>
        !carried.has(node.id) &&
        plan.changes.some(
          (change) =>
            change.end > change.start && change.start <= node.span.start && node.span.end <= change.end,
        ),
    )
    .map((node) => node.id);
  const before = state.identity.errors.length;
  const identity = reconcileSyntax(state, source, {
    changes: ordered.map(({ change }) => change),
    anchors,
    retired,
  });
  if (identity.errors.length > before) {
    throw new EditFailure(
      "edit/unreadable",
      `The edit would make the source unreadable: ${identity.errors[0]!.message}`,
    );
  }
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
  if (
    found.definition.scope === "global" &&
    before.definitions.some((definition) => definition.scope === "global" && definition.name === to)
  ) {
    throw new EditFailure("edit/name-taken", `${to} is already defined`);
  }
  const occurrences = [found.definition, ...found.references].filter(
    (occurrence) => occurrence.sourceId === context.sourceId,
  );
  const external = [found.definition, ...found.references].filter(
    (occurrence) => occurrence.sourceId !== context.sourceId,
  );
  if (external.length > 0) {
    throw new EditFailure(
      "edit/external-references",
      `${found.definition.name} is also used in ${external[0]!.sourceId}, which this edit cannot change`,
    );
  }
  const plan: Plan = { changes: [], anchors: [] };
  for (const occurrence of occurrences) {
    const change = plan.changes.push({ ...occurrence.span, text: to }) - 1;
    plan.anchors.push({ id: occurrence.nodeId, change, offset: 0, length: to.length });
  }
  const next = commit(state, plan);
  // Renaming must not change what any other name refers to.
  const after = symbolIndexFor(next, context);
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
  if (tokens.length !== 1 || tokens[0]!.kind !== "Symbol" || name.startsWith(":")) {
    throw new EditFailure("edit/invalid-name", `"${name}" is not a symbol name`);
  }
  const symbols = symbolIndexFor(state, context);
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
  for (const reference of symbols.references) {
    if (reference.sourceId !== context.sourceId || !inside.has(reference.nodeId)) continue;
    const definition = reference.definition ? definitions.get(reference.definition) : undefined;
    if (!definition || definition.scope !== "local" || inside.has(definition.nodeId)) continue;
    if (!parameters.includes(definition.name)) parameters.push(definition.name);
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
  const plan: Plan = { changes: [], anchors: [] };
  const change =
    plan.changes.push({
      start: top.span.start,
      end: top.span.start,
      text: `${definitionText}${separator}${spaces(topColumn)}`,
    }) - 1;
  const bodyStart = definitionText.indexOf("\n  ") + 3;
  plan.anchors.push({ id: target.id, change, offset: bodyStart, length: body.text.length });
  plan.changes.push({ ...target.span, text: call });
  return commit(state, plan);
}

// =============================================================================
// Layout
// =============================================================================

interface ResolvedPlace {
  readonly parent: string | null;
  /** The sibling the text goes before, or `undefined` for the end. */
  readonly before?: SyntaxNode | undefined;
  /** The sibling the text goes after, when it goes at the end. */
  readonly after?: SyntaxNode | undefined;
}

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

  /** A node that can leave its place: not the operand of a reader macro such as `'x`. */
  detachable(id: string): SyntaxNode {
    const node = this.node(id);
    if (node.parent !== null && this.node(node.parent).kind === "ReaderMacro") {
      throw new EditFailure(
        "edit/reader-macro-operand",
        "The form after a reader macro cannot be removed on its own; edit the reader-macro form",
      );
    }
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

  /** Where a trailing same-line comment after `offset` ends, if there is one. */
  trailingCommentEnd(offset: number): number | undefined {
    const rest = /^[ \t]*(;[^\n]*)/.exec(this.source.slice(offset));
    return rest ? offset + rest[0].length : undefined;
  }

  /** Whether the line containing `offset` ends in a comment. */
  lineEndsInComment(offset: number): boolean {
    const lineEnd = this.source.indexOf("\n", offset);
    const end = lineEnd < 0 ? this.source.length : lineEnd;
    return this.index.identity.nodes.some(
      (node) => node.kind === "Comment" && node.span.end === end && node.span.start >= this.lineStart(offset),
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
    const besideOperand = (node: SyntaxNode) => {
      if (node.parent !== null && this.node(node.parent).kind === "ReaderMacro") {
        throw new EditFailure(
          "edit/reader-macro-operand",
          "Nothing can be placed beside the form after a reader macro",
        );
      }
    };
    if ("before" in place) {
      const node = this.node(place.before);
      besideOperand(node);
      return { parent: node.parent, before: node };
    }
    if ("after" in place) {
      const node = this.node(place.after);
      besideOperand(node);
      const next = this.index.children(node.parent)[node.index + 1];
      return next ? { parent: node.parent, before: next, after: node } : { parent: node.parent, after: node };
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
    return { parent: place.parent, ...(before ? { before } : {}), ...(after ? { after } : {}) };
  }

  /** Text with continuation lines shifted by `delta` columns, never inside strings. */
  reindent(span: SyntaxSpan, delta: number): { text: string; map: (offset: number) => number } {
    const text = textOf(this.source, span);
    const protectedSpans = this.index.identity.nodes
      .filter((node) => node.kind === "String" || node.kind === "Error")
      .filter((node) => node.span.start < span.end && span.start < node.span.end)
      .map((node) => ({ start: node.span.start - span.start, end: node.span.end - span.start }));
    return shiftLines(text, delta, protectedSpans);
  }

  /** New text laid out at `column`: continuation lines shift with it. */
  place(text: string, column: number): { text: string; map: (offset: number) => number } {
    return shiftLines(text, column, stringSpans(text));
  }

  insertion(place: ResolvedPlace, text: string, moving?: SyntaxNode): TextChange & { placed?: SyntaxSpan } {
    const parentColumn =
      place.parent === null ? -2 : this.column(this.node(place.parent).span.start);
    const columnOf = (node: SyntaxNode) => this.column(node.span.start);
    // Text taken from the document keeps its layout relative to its first line.
    const shifted = (column: number) =>
      moving
        ? this.reindent(moving.span, column - this.column(moving.span.start))
        : this.place(text, column);
    if (place.before) {
      const anchor = place.before;
      const column = columnOf(anchor);
      const laid = shifted(column);
      if (this.startsLine(anchor.span.start) || topElements(text).at(-1)?.kind === "Comment") {
        const inserted = `${laid.text}\n${spaces(column)}`;
        return { start: anchor.span.start, end: anchor.span.start, text: inserted, placed: { start: 0, end: laid.text.length } };
      }
      return {
        start: anchor.span.start,
        end: anchor.span.start,
        text: `${laid.text} `,
        placed: { start: 0, end: laid.text.length },
      };
    }
    if (place.after) {
      const anchor = place.after;
      const ownLine = this.startsLine(anchor.span.start);
      const column = ownLine ? columnOf(anchor) : parentColumn + 2;
      const afterComment = anchor.kind === "Comment";
      const laid = shifted(column);
      const commentEnd = this.trailingCommentEnd(anchor.span.end);
      const at = commentEnd ?? anchor.span.end;
      const after = this.breakAfter(text, at, Math.max(parentColumn, 0));
      if (ownLine || afterComment || commentEnd !== undefined || place.parent === null) {
        const prefix = `\n${spaces(Math.max(column, 0))}`;
        return { start: at, end: at, text: `${prefix}${laid.text}${after}`, placed: { start: prefix.length, end: prefix.length + laid.text.length } };
      }
      return { start: at, end: at, text: ` ${laid.text}${after}`, placed: { start: 1, end: 1 + laid.text.length } };
    }
    // An empty parent, or an empty document.
    if (place.parent === null) {
      const at = this.source.length;
      const prefix = this.source.trim() === "" ? "" : "\n";
      const laid = shifted(0);
      return { start: at, end: at, text: `${prefix}${laid.text}`, placed: { start: prefix.length, end: prefix.length + laid.text.length } };
    }
    const parent = this.node(place.parent);
    const at = parent.span.end - 1;
    const laid = shifted(this.column(at));
    const opener = this.source[at - 1];
    const prefix = opener === "(" || opener === "[" || opener === "{" ? "" : " ";
    const after = this.breakAfter(text, at, this.column(parent.span.start));
    return { start: at, end: at, text: `${prefix}${laid.text}${after}`, placed: { start: prefix.length, end: prefix.length + laid.text.length } };
  }

  /** Remove a node and the whitespace that separated it; with `withComment`, a trailing comment too. */
  deletion(node: SyntaxNode, withComment = true): TextChange {
    const commentEnd = withComment ? this.trailingCommentEnd(node.span.end) : undefined;
    const end = commentEnd ?? node.span.end;
    const restOfLine = /^[ \t]*/.exec(this.source.slice(end))![0];
    const lineEnds = this.source[end + restOfLine.length] === "\n" || end + restOfLine.length === this.source.length;
    if (this.startsLine(node.span.start) && lineEnds) {
      // Remove the whole line, and the newline before it.
      const start = this.lineStart(node.span.start);
      const from = start > 0 ? start - 1 : start;
      const to = start > 0 ? end + restOfLine.length : Math.min(this.source.length, end + restOfLine.length + 1);
      return { start: from, end: to, text: "" };
    }
    const following = /^\s*/.exec(this.source.slice(end))![0];
    const next = this.source[end + following.length];
    if (next !== undefined && next !== ")" && next !== "]" && next !== "}") {
      return { start: node.span.start, end: end + following.length, text: "" };
    }
    const preceding = /\s*$/.exec(this.source.slice(0, node.span.start))![0];
    const joined = this.source.slice(0, node.span.start - preceding.length);
    if (preceding.includes("\n") && this.lineEndsInComment(joined.length)) {
      // Joining onto a line that ends in a comment would comment out what follows.
      return { start: node.span.start, end, text: "" };
    }
    return { start: node.span.start - preceding.length, end, text: "" };
  }

  /** A line break to add after inserted text that ends in a comment, unless one follows. */
  breakAfter(text: string, at: number, column: number): string {
    return topElements(text).at(-1)?.kind === "Comment" ? this.lineBreakAt(at, column) : "";
  }

  /** A line break to put at `at`, unless the line already ends there. */
  lineBreakAt(at: number, column: number): string {
    const following = /^[ \t]*/.exec(this.source.slice(at))![0];
    const next = this.source[at + following.length];
    return next === undefined || next === "\n" ? "" : `\n${spaces(column)}`;
  }
}

/** Shift continuation lines of `text` by `delta` columns, skipping lines that start inside protected spans. */
function shiftLines(
  text: string,
  delta: number,
  protectedSpans: readonly SyntaxSpan[],
): { text: string; map: (offset: number) => number } {
  const shifts: { at: number; by: number }[] = [];
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
    shifts.push({ at: lineStart, by });
  }
  result += text.slice(cursor);
  return {
    text: result,
    map: (offset) => {
      let moved = offset;
      for (const shift of shifts) {
        if (shift.at > offset) break;
        moved += shift.at === offset && shift.by < 0 ? 0 : shift.by;
      }
      return moved;
    },
  };
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
