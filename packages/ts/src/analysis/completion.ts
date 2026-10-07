/**
 * Completion: the names visible at a position, and the slots a form still
 * accepts when the position starts a keyword inside it.
 */

import type { FormDescriptor } from "../descriptor/FormDescriptor.js";
import type { FormSlots } from "../editor/slots.js";
import { kernelNameKind, type SymbolDefinition, type SymbolIndex } from "../editor/symbols.js";
import type { SyntaxIndex } from "../syntax/identity.js";

export type CompletionKind =
  | "form"
  | "keyword"
  | "function"
  | "macro"
  | "variable"
  | "parameter"
  | "type"
  | "constructor"
  | "slot";

export interface CompletionItem {
  readonly label: string;
  readonly kind: CompletionKind;
  /** A type or short description. */
  readonly detail?: string | undefined;
  /** Markdown documentation. */
  readonly documentation?: string | undefined;
  /** Orders items: locals first, then this document, then forms, then everything else. */
  readonly sortText: string;
  /** The text the item replaces, as offsets. */
  readonly replace: { readonly start: number; readonly end: number };
}

export interface CompletionRequest {
  readonly sourceId: string;
  readonly text: string;
  readonly offset: number;
  readonly symbols: SymbolIndex;
  readonly syntax: SyntaxIndex;
  readonly descriptors: readonly FormDescriptor[];
  readonly slots: () => FormSlots | undefined;
  readonly typeOf: (name: string) => string | undefined;
  readonly kernel: ReadonlySet<string>;
}

const DELIMITER = /[\s()[\]{}"';`~@,]/;

export function completionsAt(request: CompletionRequest): readonly CompletionItem[] {
  const { text, offset } = request;
  let start = offset;
  while (start > 0 && !DELIMITER.test(text[start - 1]!)) start--;
  const replace = { start, end: offset };
  const prefix = text.slice(start, offset);

  if (prefix.startsWith(":")) return slotCompletions(request, replace);

  const items = new Map<string, CompletionItem>();
  const add = (item: Omit<CompletionItem, "replace">): void => {
    if (!items.has(item.label)) items.set(item.label, { ...item, replace });
  };

  for (const definition of visibleLocals(request)) {
    add({
      label: definition.name,
      kind: definition.kind === "parameter" ? "parameter" : "variable",
      detail: request.typeOf(definition.name) ?? definition.form,
      sortText: `0${definition.name}`,
    });
  }
  const globals = request.symbols.definitions.filter((definition) => definition.scope === "global");
  for (const definition of globals.filter((item) => item.sourceId === request.sourceId)) {
    add(globalItem(request, definition, "1"));
  }
  for (const descriptor of request.descriptors) {
    add({
      label: descriptor.name,
      kind: "form",
      detail: "form",
      ...(descriptor.doc ? { documentation: descriptor.doc } : {}),
      sortText: `2${descriptor.name}`,
    });
  }
  for (const definition of globals) add(globalItem(request, definition, "3"));
  for (const name of request.kernel) {
    if (name.startsWith("__")) continue;
    const kind = kernelNameKind(name);
    add({
      label: name,
      kind: kind === "builtin" ? "function" : kind === "macro" ? "macro" : "keyword",
      detail: request.typeOf(name) ?? kind,
      sortText: `4${name}`,
    });
  }
  return [...items.values()];
}

function slotCompletions(
  request: CompletionRequest,
  replace: CompletionItem["replace"],
): readonly CompletionItem[] {
  const slots = request.slots();
  if (!slots) return [];
  return slots.slots
    .filter((slot) => slot.available)
    .map((slot) => ({
      label: `:${slot.name}`,
      kind: "slot" as const,
      detail: [slot.type, slot.required ? "required" : undefined].filter(Boolean).join(", ") || slots.form.name,
      ...(slot.doc ? { documentation: slot.doc } : {}),
      sortText: `${slot.missing ? 0 : 1}${slot.name}`,
      replace,
    }));
}

function globalItem(
  request: CompletionRequest,
  definition: SymbolDefinition,
  rank: string,
): Omit<CompletionItem, "replace"> {
  const where = definition.sourceId === request.sourceId ? "" : ` in \`${definition.sourceId}\``;
  return {
    label: definition.name,
    kind: completionKind(definition),
    detail: request.typeOf(definition.name) ?? definition.form,
    documentation: `*${definition.kind}* defined by \`${definition.form}\`${where}`,
    sortText: `${rank}${definition.name}`,
  };
}

/** Locals whose scope contains the offset, innermost first. */
function visibleLocals(request: CompletionRequest): readonly SymbolDefinition[] {
  return request.symbols.definitions
    .filter((definition) => {
      if (definition.sourceId !== request.sourceId || definition.scope !== "local") return false;
      const scope = definition.scopeNodeId ? request.syntax.node(definition.scopeNodeId) : undefined;
      return scope !== undefined && scope.span.start <= request.offset && request.offset <= scope.span.end;
    })
    .reverse();
}

function completionKind(definition: SymbolDefinition): CompletionKind {
  switch (definition.kind) {
    case "function":
    case "method":
      return "function";
    case "macro":
      return "macro";
    case "type":
    case "declaration":
      return "type";
    case "constructor":
      return "constructor";
    case "parameter":
      return "parameter";
    default:
      return "variable";
  }
}
