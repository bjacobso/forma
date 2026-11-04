import type { SExpr } from "../reader/types.js";
import { printSExpr } from "../evaluator/kvalue-to-source.js";
import type { JsonValue } from "./artifact.js";
import { canonicalJson, sha256 } from "./canonical-json.js";
import type { PayloadContract } from "./descriptor-contracts.js";

/** Authored syntax without layout or comments; record fields and set members in sorted order. */
function canonicalSyntax(expr: SExpr): string {
  switch (expr._tag) {
    case "List":
      return `(${expr.items.map(canonicalSyntax).join(" ")})`;
    case "Vector":
      return `[${expr.items.map(canonicalSyntax).join(" ")}]`;
    case "Map":
      return `{${expr.pairs.map(([key, value]) => `${canonicalSyntax(key)} ${canonicalSyntax(value)}`).sort().join(" ")}}`;
    case "Set":
      return `#{${expr.items.map(canonicalSyntax).sort().join(" ")}}`;
    default:
      return printSExpr(expr);
  }
}

function referencedNames(expr: SExpr, found: (name: string) => void): void {
  if (expr._tag === "Sym") found(expr.name);
  else if (expr._tag === "Map") for (const [key, value] of expr.pairs) { referencedNames(key, found); referencedNames(value, found); }
  else if (expr._tag === "List" || expr._tag === "Vector" || expr._tag === "Set") for (const item of expr.items) referencedNames(item, found);
}

/**
 * Content identity of an `:ir` type: SHA-256 over the root name and the
 * canonical definitions of every type it reaches. Two forms that produce the
 * same IR type from the same definitions share an identity, whatever their
 * surface syntax; any change to a reachable definition, including its
 * metadata, changes it.
 */
export function irContractId(root: string, types: ReadonlyMap<string, SExpr>): string {
  const reached = new Set<string>();
  const visit = (name: string) => {
    const definition = types.get(name);
    if (!definition || reached.has(name)) return;
    reached.add(name);
    referencedNames(definition, visit);
  };
  visit(root);
  const definitions = [...reached].sort().map((name) => [name, canonicalSyntax(types.get(name)!)]);
  return sha256(JSON.stringify({ root, types: definitions }));
}

/** Content identity of a resolved descriptor payload contract. */
export function payloadConstraintsId(constraints: PayloadContract): string {
  return sha256(canonicalJson(constraints as unknown as JsonValue));
}
