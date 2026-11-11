import { printSExpr } from "@formalang/ts/evaluator";
import { extractPreludeReference, type Entry, type FormDescriptor } from "@formalang/ts/descriptor";
import { authorNames } from "@formalang/ts/diagnostic";
import type { ModuleBinding, ModuleTypeSyntax } from "@formalang/ts/modules";
import type { Diagnostic } from "./types.js";

export interface DescribedForm {
  readonly name: string;
  readonly sourceId: string;
  readonly doc?: string;
  readonly identifiers: FormDescriptor["identifiers"];
  readonly slots: readonly (FormDescriptor["slots"][number] & { readonly required: boolean; readonly many: boolean })[];
  readonly result: FormDescriptor["resultType"];
  readonly ir?: string;
  /** Source programs that passed checking in the defining library's scope. */
  readonly examples: readonly string[];
}
export interface DescribedDefinition {
  readonly name: string;
  readonly sourceId: string;
  readonly signature: string;
  readonly doc?: string;
}
export interface LanguageDescription {
  readonly forms: readonly DescribedForm[];
  readonly functions: readonly DescribedDefinition[];
  readonly types: readonly DescribedDefinition[];
  readonly diagnostics: readonly Diagnostic[];
}

export const referenceEntries = (sourceId: string, source: string) => extractPreludeReference(sourceId, source).entries;

export function describeForm(name: string, sourceId: string, descriptor: FormDescriptor): DescribedForm {
  const clean = <T>(value: T): T => JSON.parse(authorNames(JSON.stringify(value))) as T;
  return clean({ name, sourceId, ...(descriptor.doc ? { doc: descriptor.doc } : {}),
    identifiers: descriptor.identifiers,
    slots: descriptor.slots.map(slot => ({ ...slot, ...(descriptor.surface?.holes.get(slot.name) ? { type: printSExpr(descriptor.surface.holes.get(slot.name)!) } : {}), required: slot.required ?? false, many: slot.many ?? false })),
    result: descriptor.resultType, ...(descriptor.produces ? { ir: descriptor.produces } : {}), examples: descriptor.examples ?? [] });
}

export function renderTypeSyntax(type: ModuleTypeSyntax): string {
  if (Array.isArray(type)) return `(${type.map(renderTypeSyntax).join(" ")})`;
  if (type !== null && typeof type === "object" && "fields" in type)
    return `{${type.fields.map(([key, value]) => `${renderTypeSyntax(key)} ${renderTypeSyntax(value)}`).join(" ")}}`;
  return authorNames(String(type));
}
export function describeBinding(binding: ModuleBinding, entries: readonly Entry[]): DescribedDefinition {
  const entry = entries.find(entry => entry.name === binding.identity.declaration);
  const signature = entry?.signature ?? (binding.scheme ? renderTypeSyntax(binding.scheme.type) : entry?.source ?? binding.name);
  return { name: binding.name, sourceId: binding.identity.moduleId, signature: authorNames(signature), ...(entry?.doc ? { doc: entry.doc } : {}) };
}

export function descriptionMarkdown(description: LanguageDescription): string {
  const out = ["# Forma vocabulary", "", "## Forms", ""];
  for (const form of description.forms) {
    out.push(`### ${form.name}`, "", form.doc ?? "", "");
    if (form.identifiers.length) out.push(`Identifiers: ${form.identifiers.map(id => `${id.name}: ${id.kind}`).join(", ")}.`, "");
    for (const slot of form.slots) out.push(`- ${slot.name}: ${slot.type ?? slot.mode}${slot.required ? " (required)" : " (optional)"}${slot.many ? " (many)" : ""}`);
    out.push("", `Result: ${form.result.kind === "constant" ? form.result.type : "computed"}${form.ir ? `; IR: ${form.ir}` : ""}.`, "");
    for (const example of form.examples) out.push("```lisp", example, "```", "");
  }
  for (const [heading, entries] of [["Functions", description.functions], ["Types", description.types]] as const) {
    out.push(`## ${heading}`, "");
    for (const entry of entries) out.push(`### ${entry.name}`, "", entry.doc ?? "", "", "```lisp", entry.signature, "```", "");
  }
  return out.join("\n");
}
