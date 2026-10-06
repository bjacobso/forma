import type { SExpr } from "../reader/types.js";
import type { DescriptorExtensionValue, FormDescriptor } from "../descriptor/FormDescriptor.js";
import { head, name } from "./effect.js";

/** Consumers read constant configuration records through the descriptor registry. */
export function metadataDescriptor(expression: SExpr): FormDescriptor | undefined {
  if (head(expression) !== "define" || expression._tag !== "List") return;
  const value = head(expression.items[2]) === "quote" && expression.items[2]?._tag === "List" ? expression.items[2].items[1] : expression.items[2];
  if (value?._tag !== "Map") return;
  const extensions = value.pairs.find(([key]) => name(key) === ":extensions")?.[1];
  if (extensions?._tag !== "Map") return;
  const descriptorName = value.pairs.find(([key]) => name(key) === ":descriptor-name")?.[1];
  return { name: descriptorName?._tag === "Str" ? descriptorName.value : name(expression.items[1])!, phase: "meta", identifiers: [], slots: [], bindings: {kind:"none"}, validation:{kind:"none"}, elaboration:{kind:"none"}, resultType:{kind:"none"}, extensions: constant(extensions) as Record<string,DescriptorExtensionValue> };
}

function constant(expression: SExpr): DescriptorExtensionValue {
  if (expression._tag === "Str" || expression._tag === "Num" || expression._tag === "Bool") return expression.value;
  if (expression._tag === "Sym" && expression.name.startsWith(":")) return expression.name.slice(1);
  if (expression._tag === "Vector") return expression.items.map(constant);
  if (expression._tag === "Map") return Object.fromEntries(expression.pairs.map(([key,value]) => [name(key)?.replace(/^:/,"") ?? (key._tag === "Str" ? key.value : ""),constant(value)]));
  throw new Error("Descriptor configuration must contain constant values");
}
