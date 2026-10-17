import type { ModuleGraph, ModuleBinding } from "../modules/graph.js";
import type { FormDescriptor } from "../descriptor/FormDescriptor.js";
import { parse } from "../reader/parser.js";
import { toSExprMany } from "../reader/to-sexpr.js";
import type { FormatOptions } from "./layout.js";
import { declarations } from "./patterns.js";

/** Visible authored names, including named aliases, namespaces and re-exports.
 * Resolution belongs to the host; this helper has no filesystem state. */
export function moduleFormatOptions(graph: ModuleGraph): FormatOptions {
  const entry = graph.modules.find(m => m.id === graph.entry);
  if (!entry) return {};
  const descriptors: FormDescriptor[] = [];
  const macroSignatures = declarations(toSExprMany(parse(entry.source).redTree), "macro");
  const add = (name: string, binding: ModuleBinding) => {
    if (binding.kind === "form") {
      const form = entry.compileTime?.forms.get(binding.symbol);
      if (form) descriptors.push({ ...form.descriptor, name });
    }
    if (binding.kind === "macro") {
      const owner = graph.modules.find(m => m.id === binding.identity.moduleId);
      const signature = owner && declarations(toSExprMany(parse(owner.source).redTree), "macro").get(binding.identity.declaration);
      if (signature) macroSignatures.set(name, signature);
    }
  };
  for (const [name, binding] of [...entry.bindings, ...entry.imports]) add(name, binding);
  for (const [alias, id] of entry.namespaceAliases ?? []) {
    const target = graph.modules.find(m => m.id === id);
    for (const binding of target?.interface.exports ?? []) add(`${alias}/${binding.name}`, binding);
  }
  return { descriptors, macroSignatures };
}
