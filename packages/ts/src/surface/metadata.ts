import type { SExpr } from "../reader/types.js";
import type { DescriptorExtensionValue, FormDescriptor } from "../descriptor/FormDescriptor.js";
import { head, name } from "./effect.js";

/** Consumers read standalone constant configuration through the descriptor registry. */
export function metadataDescriptor(expression: SExpr): FormDescriptor | undefined {
  if (head(expression) !== "define" || expression._tag !== "List") return;
  const value = head(expression.items[2]) === "quote" && expression.items[2]?._tag === "List" ? expression.items[2].items[1] : expression.items[2];
  if (value?._tag !== "Map") return;
  const extensions = value.pairs.find(([key]) => name(key) === ":extensions")?.[1];
  if (extensions?._tag !== "Map") return;
  // Deprecated form attachment convention. Bundled forms use :extensions directly.
  const descriptorName = value.pairs.find(([key]) => name(key) === ":descriptor-name")?.[1];
  return { name: descriptorName?._tag === "Str" ? descriptorName.value : name(expression.items[1])!, phase: "meta", identifiers: [], slots: [], bindings: {kind:"none"}, validation:{kind:"none"}, elaboration:{kind:"none"}, resultType:{kind:"none"}, extensions: descriptorConstant(extensions) as Record<string,DescriptorExtensionValue> };
}

function invalidConstant(expression: SExpr, message: string): never {
  throw Object.assign(new Error(message), { loc: expression.loc });
}

/** Parse configuration as data, preserving a useful location on invalid syntax. */
export function descriptorConstant(expression: SExpr): DescriptorExtensionValue {
  if (expression._tag === "Str" || expression._tag === "Num" || expression._tag === "Bool") return expression.value;
  if (expression._tag === "Sym" && expression.name === "nil") return null;
  if (expression._tag === "Sym" && expression.name.startsWith(":")) return expression.name.slice(1);
  if (expression._tag === "Vector") return expression.items.map(descriptorConstant);
  if (expression._tag === "Map") {
    const names = new Set<string>();
    return Object.fromEntries(expression.pairs.map(([key, value]) => {
      const field = key._tag === "Str" ? key.value : key._tag === "Sym" && key.name.startsWith(":") ? key.name.slice(1) : undefined;
      if (field === undefined) return invalidConstant(key, "Descriptor configuration map keys must be strings or keywords");
      if (names.has(field)) return invalidConstant(key, `Duplicate descriptor configuration key ${field}`);
      names.add(field);
      return [field, descriptorConstant(value)];
    }));
  }
  return invalidConstant(expression, "Descriptor configuration must contain constant values");
}
