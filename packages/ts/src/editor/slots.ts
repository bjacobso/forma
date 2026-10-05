/**
 * Slot affordances: which identifiers and slots a descriptor-registered form
 * accepts, which are present, and where to insert the missing ones, so an
 * editor can offer placeholders such as `+ trigger`.
 */

import type { FormDescriptor, SlotSpec } from "../descriptor/FormDescriptor.js";
import {
  identifySyntax,
  indexSyntax,
  type SyntaxIdentity,
  type SyntaxIndex,
  type SyntaxNode,
  type SyntaxSpan,
} from "../syntax/identity.js";
import { editorDescriptors, type DescriptorSource } from "./descriptors.js";
import type { EditPlace } from "./edit-script.js";

export interface FormSlotsRequest {
  readonly source: string;
  readonly identity?: SyntaxIdentity | undefined;
  /** A position inside the form, or inside one of its slots. */
  readonly offset?: number | undefined;
  /** Or the id of the form, or of a node inside it. */
  readonly nodeId?: string | undefined;
  readonly descriptors?: DescriptorSource | undefined;
  /** Further sources whose `define-form`s describe forms (such as preludes). */
  readonly descriptorSources?: readonly string[] | undefined;
}

/** Where and what to insert to fill an identifier or slot, as an edit-script `insert`. */
export interface SlotInsertion {
  readonly at: EditPlace;
  readonly text: string;
  /** Offset in `text` where the value goes. */
  readonly cursor: number;
}

export interface IdentifierAffordance {
  readonly name: string;
  readonly kind: "Symbol" | "String" | "Value";
  readonly declaration: boolean;
  readonly doc?: string | undefined;
  readonly nodeId?: string | undefined;
  readonly span?: SyntaxSpan | undefined;
  /** Present only when the identifier is missing. */
  readonly insertion?: SlotInsertion | undefined;
}

export interface SlotOccurrence {
  /** The `(:slot …)` list. */
  readonly nodeId: string;
  readonly span: SyntaxSpan;
  /** The values after the slot keyword. */
  readonly values: readonly { readonly nodeId: string; readonly span: SyntaxSpan }[];
}

export interface SlotAffordance {
  readonly name: string;
  readonly mode: SlotSpec["mode"];
  readonly required: boolean;
  readonly many: boolean;
  readonly type?: string | undefined;
  readonly doc?: string | undefined;
  readonly aliases: readonly string[];
  /** A child form's name when the slot holds child forms. */
  readonly childForm?: string | undefined;
  readonly occurrences: readonly SlotOccurrence[];
  /** No occurrence, or only occurrences without values. */
  readonly empty: boolean;
  /** Required and empty. */
  readonly missing: boolean;
  /** Whether another occurrence may be added. */
  readonly available: boolean;
  /** Label for an editor placeholder, such as `+ trigger`. */
  readonly placeholder: string;
  readonly insertion: SlotInsertion;
}

export interface FormSlots {
  readonly form: {
    readonly name: string;
    readonly nodeId: string;
    readonly span: SyntaxSpan;
    readonly phase: FormDescriptor["phase"];
    readonly doc?: string | undefined;
  };
  readonly identifiers: readonly IdentifierAffordance[];
  readonly slots: readonly SlotAffordance[];
  /** The slot whose occurrence contains the requested position. */
  readonly activeSlot?: string | undefined;
  /** Keyword-headed lists that name no slot of this form. */
  readonly unknownSlots: readonly { readonly name: string; readonly nodeId: string }[];
}

/** Slot affordances for the innermost descriptor form at a position or node. */
export function formSlots(request: FormSlotsRequest): FormSlots | undefined {
  const { source } = request;
  const identity = request.identity ?? identifySyntax(source);
  const index = indexSyntax(identity);
  const descriptors = editorDescriptors(
    [...(request.descriptorSources ?? []), source],
    request.descriptors,
  );
  const start =
    request.nodeId !== undefined
      ? index.node(request.nodeId)
      : request.offset !== undefined
        ? index.at(request.offset) ?? index.at(Math.max(0, request.offset - 1))
        : undefined;
  if (!start) return undefined;
  for (const node of [start, ...index.ancestors(start.id)]) {
    if (node.kind !== "List") continue;
    const head = headOf(source, index, node);
    const descriptor = head ? descriptors.get(head.name) : undefined;
    if (descriptor) return affordances(source, index, node, head!.node, descriptor, start);
  }
  return undefined;
}

function affordances(
  source: string,
  index: SyntaxIndex,
  form: SyntaxNode,
  head: SyntaxNode,
  descriptor: FormDescriptor,
  at: SyntaxNode,
): FormSlots {
  const text = (span: SyntaxSpan) => source.slice(span.start, span.end);
  const elements = index.children(form.id).filter((node) => node.kind !== "Comment");
  const args = elements.slice(1);
  const slotLists = args.filter((arg) => keywordHead(source, index, arg) !== undefined);
  const positional = args.filter((arg) => keywordHead(source, index, arg) === undefined);

  const identifiers = descriptor.identifiers.map((spec, position): IdentifierAffordance => {
    const node = positional[position];
    const base = {
      name: spec.name,
      kind: spec.kind,
      declaration: spec.declaration === true,
      ...(spec.doc ? { doc: spec.doc } : {}),
    };
    if (node) return { ...base, nodeId: node.id, span: node.span };
    // Inserting before whatever follows keeps several missing identifiers in
    // order when their insertions are applied one after another.
    const next = args.find((arg) => arg.span.start > (positional[position - 1] ?? head).span.end);
    const at = next ? { before: next.id } : { parent: form.id };
    return { ...base, insertion: { at, text: spec.name, cursor: 0 } };
  });

  const inside = new Set(index.ancestors(at.id).map((node) => node.id).concat(at.id));
  let activeSlot: string | undefined;
  const known = new Set<string>();
  const slots = descriptor.slots.map((spec): SlotAffordance => {
    const names = [spec.name, ...(spec.aliases ?? [])];
    names.forEach((name) => known.add(name));
    const occurrences = slotLists
      .filter((list) => names.includes(keywordHead(source, index, list)!.name))
      .map((list): SlotOccurrence => {
        if (inside.has(list.id)) activeSlot = spec.name;
        const values = index
          .children(list.id)
          .filter((node) => node.kind !== "Comment")
          .slice(1)
          .map((node) => ({ nodeId: node.id, span: node.span }));
        return { nodeId: list.id, span: list.span, values };
      });
    const empty = occurrences.every((occurrence) => occurrence.values.length === 0);
    const lastOccurrence = occurrences.at(-1);
    const template = `(:${spec.name} )`;
    return {
      name: spec.name,
      mode: spec.mode,
      required: spec.required === true,
      many: spec.many === true,
      ...(spec.type ? { type: spec.type } : {}),
      ...(spec.doc ? { doc: spec.doc } : {}),
      aliases: spec.aliases ?? [],
      ...(spec.childShape ? { childForm: spec.childShape.formName } : {}),
      occurrences,
      empty,
      missing: spec.required === true && empty,
      available: occurrences.length === 0 || spec.many === true,
      placeholder: `+ ${spec.name}`,
      insertion: {
        at: lastOccurrence
          ? { after: lastOccurrence.nodeId }
          : { parent: form.id },
        text: template,
        cursor: template.length - 1,
      },
    };
  });
  const unknownSlots = slotLists
    .map((list) => ({ name: keywordHead(source, index, list)!.name, nodeId: list.id }))
    .filter((slot) => !known.has(slot.name));
  return {
    form: {
      name: text(head.span),
      nodeId: form.id,
      span: form.span,
      phase: descriptor.phase,
      ...(descriptor.doc ? { doc: descriptor.doc } : {}),
    },
    identifiers,
    slots,
    ...(activeSlot ? { activeSlot } : {}),
    unknownSlots,
  };
}

function headOf(
  source: string,
  index: SyntaxIndex,
  node: SyntaxNode,
): { name: string; node: SyntaxNode } | undefined {
  const first = index.children(node.id).find((child) => child.kind !== "Comment");
  if (first?.kind !== "Symbol") return undefined;
  return { name: source.slice(first.span.start, first.span.end), node: first };
}

/** The slot name of a `(:slot …)` list. */
function keywordHead(source: string, index: SyntaxIndex, node: SyntaxNode): { name: string } | undefined {
  if (node.kind !== "List") return undefined;
  const head = headOf(source, index, node);
  return head && head.name.startsWith(":") && head.name.length > 1
    ? { name: head.name.slice(1) }
    : undefined;
}
