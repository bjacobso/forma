/** Host type configuration is data, never an implicit declaration of a type. */
import { InferenceError } from "../diagnostic/errors.js";
import type { SExpr } from "../Reader.js";
import { parse, toSExprMany } from "../reader/index.js";

export const hostTypeNames = new Set([
  "Number", "Num", "Int", "Float", "String", "Str", "Boolean", "Bool",
  "Unit", "Nil", "Any", "Unknown", "Keyword", "Symbol", "Syntax",
  "Map", "List", "Vector", "Declaration",
]);

function object(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : {};
}

export function validateHostTypes(request: { readonly hostBuiltins?: unknown; readonly typePolicy?: unknown }, source = ""): void {
  if (request.typePolicy === undefined && (request.hostBuiltins === undefined || Array.isArray(request.hostBuiltins) && request.hostBuiltins.length === 0)) return;
  const symbols: SExpr[] = [];
  const visit = (expr: SExpr): void => {
    if (expr._tag === "Sym") symbols.push(expr);
    else if ("items" in expr) expr.items.forEach(visit);
    else if (expr._tag === "Map") expr.pairs.forEach(([k, v]) => { visit(k); visit(v); });
  };
  toSExprMany(parse(source).redTree).forEach(visit);
  const fail = (code: string, path: string, message: string, matches: (name: string) => boolean): never => {
    const expr = symbols.find(e => e._tag === "Sym" && matches(e.name));
    throw new InferenceError({
      message: `${path}: ${message}`,
      details: { code, path },
      origin: { nodeId: path, kind: "host-type", span: { start: expr?.loc.start ?? 0, end: expr?.loc.end ?? 0 } },
    });
  };
  const scheme = (value: unknown, code: string, path: string, matches: (name: string) => boolean, seen = new Set<unknown>()): void => {
    const expr = object(value);
    const bad = (message: string): never => fail(code, path, message, matches);
    if (seen.has(value)) bad("Type schemes must be acyclic.");
    seen.add(value);
    const child = (key: string) => scheme(expr[key], code, `${path}.${key}`, matches, new Set(seen));
    switch (expr.kind) {
      case "type":
        if (typeof expr.name !== "string" || !hostTypeNames.has(expr.name))
          bad(`Unknown type name ${JSON.stringify(expr.name)}. Use a supported host type: ${[...hostTypeNames].join(", ")}.`);
        break;
      case "any": break;
      case "function": case "variadic-function":
        if (!Array.isArray(expr.params)) bad("params must be an array of type schemes.");
        (expr.params as unknown[]).forEach((p, i) => scheme(p, code, `${path}.params[${i}]`, matches, new Set(seen)));
        if (expr.kind === "variadic-function") child("rest");
        child("result");
        break;
      case "list": child("item"); break;
      case "map": child("key"); child("value"); break;
      default: bad(`Unsupported scheme kind ${JSON.stringify(expr.kind)}. Use type, any, function, variadic-function, list, or map.`);
    }
  };
  if (request.typePolicy !== undefined) {
    const policy = object(request.typePolicy), code = "typecheck/type-policy";
    if (!request.typePolicy || typeof request.typePolicy !== "object" || Array.isArray(request.typePolicy))
      fail(code, "typePolicy", "Expected an object.", () => false);
    if (policy.defaultBuiltinScheme !== undefined && policy.defaultBuiltinScheme !== "kernel" && policy.defaultBuiltinScheme !== "none")
      fail(code, "typePolicy.defaultBuiltinScheme", "Expected kernel or none.", () => false);
    if (policy.unboundSymbols !== undefined && !Array.isArray(policy.unboundSymbols))
      fail(code, "typePolicy.unboundSymbols", "Expected an array.", () => false);
    for (const [i, value] of ((policy.unboundSymbols ?? []) as unknown[]).entries()) {
      const entry = object(value), match = object(entry.match), path = `typePolicy.unboundSymbols[${i}]`;
      if ((match.kind !== "exact" && match.kind !== "prefix") || typeof match.value !== "string" || match.kind === "exact" && !match.value.length)
        fail(code, `${path}.match`, "Expected exact or prefix and a string value; exact matches must be nonempty.", () => false);
      const matches = (name: string) => match.kind === "exact" ? name === match.value : name.startsWith(match.value as string);
      scheme(entry.type, code, `${path}.type`, matches);
    }
  }
  if (request.hostBuiltins !== undefined) {
    if (!Array.isArray(request.hostBuiltins)) fail("typecheck/host-builtin", "hostBuiltins", "Expected an array.", () => false);
    for (const [i, value] of (request.hostBuiltins as unknown[]).entries()) {
      const builtin = object(value), path = `hostBuiltins[${i}]`;
      if (typeof builtin.name !== "string" || !builtin.name.trim())
        fail("typecheck/host-builtin", `${path}.name`, "Expected a nonempty builtin name.", () => false);
      if (builtin.typeScheme !== undefined) scheme(builtin.typeScheme, "typecheck/host-builtin", `${path}.typeScheme`, n => n === builtin.name);
    }
  }
}
