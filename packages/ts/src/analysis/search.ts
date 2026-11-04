/**
 * Search: find existing forms and definitions by what they are called, what
 * their documentation says, and what they produce, before writing new ones.
 */

import type { FormDescriptor } from "../descriptor/FormDescriptor.js";
import type { SymbolDefinition, SymbolIndex } from "../editor/symbols.js";
import type { SyntaxIndex, SyntaxNode, SyntaxSpan } from "../syntax/identity.js";

export interface SearchQuery {
  /** Words to match against names and documentation. */
  readonly text?: string | undefined;
  /** Keep only forms whose `:ir` type is this name. */
  readonly produces?: string | undefined;
  /** Keep only entries whose type or `:ir` type mentions this type name. */
  readonly type?: string | undefined;
  /** Maximum results. Default 50. */
  readonly limit?: number | undefined;
}

export interface SearchResult {
  readonly name: string;
  readonly kind: "form" | SymbolDefinition["kind"];
  readonly sourceId?: string | undefined;
  readonly span?: SyntaxSpan | undefined;
  /** The inferred type, for definitions. */
  readonly type?: string | undefined;
  /** The `:ir` type, for forms. */
  readonly produces?: string | undefined;
  readonly doc?: string | undefined;
  readonly score: number;
}

export interface SearchInput {
  readonly descriptors: readonly FormDescriptor[];
  readonly symbols: SymbolIndex;
  readonly text: (sourceId: string) => string | undefined;
  readonly syntax: (sourceId: string) => SyntaxIndex;
  readonly typeOf: (definition: SymbolDefinition) => string | undefined;
}

interface Entry extends Omit<SearchResult, "score" | "type"> {
  /** Lowercase words of the name and of the documentation. */
  readonly nameWords: readonly string[];
  readonly docWords: readonly string[];
  /** Inferring a type can analyze a whole source, so it waits until needed. */
  readonly type: () => string | undefined;
}

const words = (text: string | undefined): string[] =>
  (text ?? "")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);

const typeNames = (text: string | undefined): ReadonlySet<string> =>
  new Set((text ?? "").split(/[^A-Za-z0-9_/-]+/).filter(Boolean));

/** Find forms and global definitions, best matches first. */
export function searchDefinitions(input: SearchInput, query: SearchQuery): readonly SearchResult[] {
  const queryWords = words(query.text);
  const phrase = queryWords.join("-");
  const results: (Entry & { readonly score: number })[] = [];
  for (const entry of entries(input)) {
    if (query.produces !== undefined && entry.produces !== query.produces) continue;
    if (query.type !== undefined && !typeNames(entry.type()).has(query.type) && !typeNames(entry.produces).has(query.type)) continue;
    // More query words matched ranks first; among equals, name matches beat documentation.
    let score = queryWords.length === 0 ? 1 : 0;
    for (const word of queryWords) {
      if (entry.nameWords.includes(word)) score += 13;
      else if (entry.nameWords.some((candidate) => candidate.startsWith(word))) score += 12;
      else if (entry.docWords.some((candidate) => candidate.startsWith(word))) score += 11;
    }
    if (score === 0) continue;
    if (phrase && entry.nameWords.join("-") === phrase) score += 1;
    results.push({ ...entry, score });
  }
  return results
    .sort((left, right) => right.score - left.score || left.name.localeCompare(right.name, "en"))
    .slice(0, query.limit ?? 50)
    .map(({ nameWords: _name, docWords: _doc, type: typeOf, ...result }) => {
      const type = typeOf();
      return type ? { ...result, type } : result;
    });
}

function* entries(input: SearchInput): Iterable<Entry> {
  const globals = input.symbols.definitions.filter(
    (definition) => definition.scope === "global" && !definition.name.startsWith("__"),
  );
  const forms = new Set<string>();
  for (const descriptor of input.descriptors) {
    // Type declarations register meta descriptors; they are found as types below.
    if (descriptor.phase === "meta" || descriptor.name.startsWith("__") || forms.has(descriptor.name)) continue;
    forms.add(descriptor.name);
    const definition = globals.find((candidate) => candidate.name === descriptor.name);
    const slotDocs = descriptor.slots.map((slot) => slot.doc ?? "").join(" ");
    yield {
      name: descriptor.name,
      kind: "form",
      ...(definition ? { sourceId: definition.sourceId, span: definition.span } : {}),
      ...(descriptor.produces ? { produces: descriptor.produces } : {}),
      ...(descriptor.doc ? { doc: descriptor.doc } : {}),
      type: () => undefined,
      nameWords: words(descriptor.name),
      docWords: words(`${descriptor.doc ?? ""} ${slotDocs} ${descriptor.produces ?? ""}`),
    };
  }
  for (const definition of globals) {
    if (forms.has(definition.name)) continue;
    const doc = documentation(input, definition);
    let type: { readonly value: string | undefined } | undefined;
    yield {
      name: definition.name,
      kind: definition.kind,
      sourceId: definition.sourceId,
      span: definition.span,
      type: () => (type ??= { value: input.typeOf(definition) }).value,
      ...(doc ? { doc } : {}),
      nameWords: words(definition.name),
      docWords: words(doc),
    };
  }
}

/**
 * A definition's documentation: a docstring after its name, or else the
 * comment lines directly above its top-level form (or above its `(: name type)`
 * signature).
 */
function documentation(input: SearchInput, definition: SymbolDefinition): string | undefined {
  const text = input.text(definition.sourceId);
  if (text === undefined || definition.formNodeId === undefined) return undefined;
  const syntax = input.syntax(definition.sourceId);
  const form = syntax.node(definition.formNodeId);
  if (!form) return undefined;
  const items = syntax.children(form.id).filter((node) => node.kind !== "Comment");
  const third = items[2];
  if (items.length > 3 && third?.kind === "String") return unquote(text.slice(third.span.start, third.span.end));
  if (form.parent !== null) return undefined;
  const siblings = syntax.children(null);
  let index = siblings.findIndex((node) => node.id === form.id) - 1;
  const signature = siblings[index];
  if (signature && isSignature(text, syntax, signature, definition.name)) index--;
  const lines: string[] = [];
  let below = siblings[index + 1] ?? form;
  for (; index >= 0; index--) {
    const node = siblings[index]!;
    if (node.kind !== "Comment" || /\n[ \t]*\n/.test(text.slice(node.span.end, below.span.start))) break;
    lines.unshift(text.slice(node.span.start, node.span.end).replace(/^;+\s?/, ""));
    below = node;
  }
  const doc = lines.filter((line) => !/^[\s\-=─;*]*$/.test(line)).join(" ").trim();
  return doc || undefined;
}

function isSignature(text: string, syntax: SyntaxIndex, node: SyntaxNode, name: string): boolean {
  if (node.kind !== "List") return false;
  const [head, subject] = syntax.children(node.id).filter((child) => child.kind !== "Comment");
  return (
    head !== undefined &&
    text.slice(head.span.start, head.span.end) === ":" &&
    subject !== undefined &&
    text.slice(subject.span.start, subject.span.end) === name
  );
}

function unquote(literal: string): string {
  return literal.slice(1, -1).replace(/\\(.)/g, (_, character: string) => (character === "n" ? "\n" : character === "t" ? "\t" : character));
}
