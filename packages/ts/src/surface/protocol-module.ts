import type { SExpr } from "../reader/types.js";
import { InferenceError } from "../diagnostic/errors.js";
import type { DescriptorExtensionValue, FormDescriptor } from "../descriptor/FormDescriptor.js";
import { head, name } from "./effect.js";

function invalidManifest(message: string, at: SExpr): never {
  throw Object.assign(new InferenceError({
    message,
    details: { code: "surface/invalid-form" },
  }), { loc: at.loc });
}

/** A protocol manifest names the module and its imports. Its types are derived. */
export function protocolModuleDescriptor(expressions: readonly SExpr[], forms: readonly FormDescriptor[]): FormDescriptor | undefined {
  const definition = expressions.find(e => head(e) === "define" && e._tag === "List" && name(e.items[1]) === "protocol");
  if (definition?._tag !== "List" || definition.items[2]?._tag !== "Map") return undefined;
  const manifest = definition.items[2];
  const config: Record<string, DescriptorExtensionValue> = {};
  for (const [key, value] of manifest.pairs) {
    const field = name(key)?.replace(/^:/, "");
    if (!field || !["name", "imports"].includes(field)) invalidManifest(`Unknown protocol manifest field ${name(key)}`, key);
    config[field] = literal(value);
  }
  if (typeof config.name !== "string") invalidManifest("Protocol manifests require a name", manifest);
  for (const [category, extension] of [["types", "protocol/type"], ["objects", "protocol/object"], ["enums", "protocol/enum"], ["unions", "protocol/union"]]) {
    config[category!] = forms.flatMap(form => {
      const metadata = form.extensions?.[extension!];
      return metadata && typeof metadata === "object" && !Array.isArray(metadata) && "name" in metadata && typeof metadata.name === "string" ? [metadata.name] : [];
    });
  }
  return { name: `${config.name}-protocol-module`, phase: "meta", identifiers: [], slots: [], bindings: { kind: "none" }, validation: { kind: "none" }, elaboration: { kind: "none" }, resultType: { kind: "none" }, extensions: { "protocol/module": config } };
}

function literal(value: SExpr): DescriptorExtensionValue {
  if (value._tag === "Str" || value._tag === "Num" || value._tag === "Bool") return value.value;
  if (value._tag === "Vector") return value.items.map(literal);
  return invalidManifest("Protocol manifest values must be literals or vectors of literals", value);
}
