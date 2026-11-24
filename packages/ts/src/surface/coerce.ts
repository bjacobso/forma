import { resolveTypeAlias } from "./type-alias.js";
import { copySourceTrace } from "../evaluator/source-trace.js";
import { isFloatLiteral, type SExpr } from "../reader/types.js";
import { head, name, list, sym } from "./effect.js";

type TypeBindings = ReadonlyMap<string, SExpr>;
type NumericKind = "Float" | "Int" | "NonNumeric" | undefined;

const FLOAT_RETURN_OPS = new Set(["/", "sqrt", "pow"]);
const INT_RETURN_OPS = new Set(["mod", "quot", "floor", "ceil", "round", "count", "length", "index-of"]);
const POLYMORPHIC_NUMERIC_OPS = new Set(["+", "-", "*", "min", "max", "abs"]);
const NON_NUMERIC_OPS = new Set([
  "=", "!=", "<", "<=", ">", ">=",
  "empty?", "contains?", "not", "and", "or",
  "is-nil", "is-string", "is-number", "is-boolean", "is-list", "is-map",
  "str", "format", "upcase", "downcase", "uppercase", "lowercase", "trim", "substring", "subs", "replace", "join",
]);

function joinNumericKinds(kinds: readonly NumericKind[]): NumericKind {
  if (kinds.some((k) => k === "NonNumeric")) return "NonNumeric";
  if (kinds.some((k) => k === "Float")) return "Float";
  if (kinds.length > 0 && kinds.every((k) => k === "Int")) return "Int";
  return undefined;
}

/** Insert the Option constructors required by a record's contextual type and Int-to-Float branch coercions. */
export function coerceProgram(exprs: readonly SExpr[], externalTypes: ReadonlyMap<string,SExpr> = new Map(), contextTypes: readonly SExpr[] = []): readonly SExpr[] {
  return runCoerceProgram(exprs, externalTypes, contextTypes, false);
}

/** Insert only Int-to-Float coercions at mixed branch joins (used after macro expansion). */
export function coerceNumericBranches(exprs: readonly SExpr[], contextTypes: readonly SExpr[] = []): readonly SExpr[] {
  return runCoerceProgram(exprs, new Map(), contextTypes, true);
}

function runCoerceProgram(
  exprs: readonly SExpr[],
  externalTypes: ReadonlyMap<string, SExpr>,
  contextTypes: readonly SExpr[],
  numericOnly: boolean,
): readonly SExpr[] {
  const aliases = new Map<string, SExpr>();
  const signatures = new Map<string, SExpr>(externalTypes);
  const constructors = new Map<string, readonly SExpr[]>();
  const definitions = new Map<string, SExpr>();
  const resolving = new Set<string>();
  for (const expr of [...contextTypes, ...exprs]) {
    if (expr._tag !== "List") continue;
    if (head(expr) === "__record-type" && expr.items[1]?._tag === "Sym" && expr.items[2]) {
      constructors.set(expr.items[1].name, [expr.items[2]]);
      aliases.set(expr.items[1].name, expr.items[2]);
    }
    if (head(expr) === "define" && name(expr.items[1]) && expr.items[2]) definitions.set(name(expr.items[1])!, expr.items[2]);
    if (head(expr) === "__sum-type" && expr.items[1]?._tag === "Sym" && expr.items[2]) {
      aliases.set(expr.items[1].name, expr.items[2]);
    }
    if (head(expr)==="__type-alias" && expr.items[1]?._tag==="List" && expr.items[2]) {
      const header=expr.items[1];
      aliases.set(name(header.items[0])!,list(expr,[sym(expr,"__type-function"),{...header,_tag:"Vector",items:header.items.slice(1)},expr.items[2]]));
    }
    if (head(expr) === "__sum-type" && expr.items[1]?._tag === "List") {
      for (const arm of expr.items.slice(2)) {
        if (arm._tag !== "List" || !name(arm.items[0])) continue;
        constructors.set(name(arm.items[0])!, arm.items.slice(1));
        constructors.set(`${name(expr.items[1].items[0])}.${name(arm.items[0])}`, arm.items.slice(1));
      }
    }
    if (head(expr) === ":" && name(expr.items[1]) && expr.items[2]) {
      signatures.set(name(expr.items[1])!, expr.items[2]);
    }
  }
  const resolve = (type: SExpr): SExpr => resolveTypeAlias(type,aliases);
  const fieldName = (expr: SExpr): string | undefined => expr._tag === "Str" ? JSON.stringify(expr.value) : name(expr);
  const call = (expr: SExpr, h: string, ...args: SExpr[]) => list(expr, [sym(expr, h), ...args]);
  const functionResult = (type?: SExpr) => type?._tag === "List" && head(type) === "->" ? type.items.at(-1) : undefined;
  const expressionType = (expr: SExpr, bindings: TypeBindings): SExpr | undefined => {
    const h = head(expr) ?? name(expr);
    if (["Some", "None", "Option.Some", "Option.None"].includes(h ?? "")) return call(expr, "Option", sym(expr, "Unknown"));
    const n = name(expr);
    if (n) {
      const declared=bindings.get(n) ?? signatures.get(n);
      if (declared) return declared;
      const [owner,...fields]=n.split(".");
      let type=bindings.get(owner!) ?? signatures.get(owner!);
      for (const field of fields) {
        const record=type ? resolve(type) : undefined;
        type=record?._tag === "Map" ? record.pairs.find(([key])=>fieldName(key)===`:${field}`)?.[1] : undefined;
      }
      return type;
    }
    if (head(expr) === ":" && expr._tag === "List") return expr.items[2];
    if (head(expr) === "get" && expr._tag === "List" && expr.items[1] && expr.items[2]) {
      const owner=expressionType(expr.items[1],bindings), record=owner ? resolve(owner) : undefined;
      return record?._tag === "Map" ? record.pairs.find(([key])=>fieldName(key)===fieldName(expr.items[2]!))?.[1] : undefined;
    }
    if (expr._tag === "List") {
      if (h === "if" || h === "match") {
        const branches = h === "if" ? expr.items.slice(2) : expr.items.filter((_, i) => i >= 3 && i % 2 === 1);
        const types = branches.map(branch => expressionType(branch, bindings));
        return types.length && types.every(type => type && head(resolve(type)) === "Option") ? types[0] : undefined;
      }
      if (h === "do") return expressionType(expr.items.at(-1)!, bindings);
      if (h === "let" && expr.items[1]?._tag === "Vector") {
        const locals = new Map(bindings);
        const values = expr.items[1].items;
        for (let i = 0; i < values.length; i += 2) {
          const type = values[i + 1] && expressionType(values[i + 1]!, locals);
          if (name(values[i]) && type) locals.set(name(values[i])!, type);
        }
        return expressionType(expr.items.at(-1)!, locals);
      }
      const declared = functionResult(bindings.get(h ?? "") ?? signatures.get(h ?? ""));
      if (declared) return declared;
      if (h && aliases.has(h) && constructors.has(h)) return sym(expr, h);
      const definition = definitions.get(h ?? "");
      if (h && definition && !resolving.has(h)) {
        resolving.add(h);
        try {
          const locals = new Map(bindings);
          if (head(definition) === "fn" && definition._tag === "List" && definition.items[1]?._tag === "Vector") {
            definition.items[1].items.forEach((param, i) => {
              const arg = expr.items[i + 1], type = arg && expressionType(arg, bindings);
              if (name(param) && type) locals.set(name(param)!, type);
            });
            return expressionType(definition.items.at(-1)!, locals);
          }
          return expressionType(definition, locals);
        } finally { resolving.delete(h); }
      }
    }
    return undefined;
  };
  const isOption = (expr: SExpr, bindings: TypeBindings) => {
    const h = head(expr) ?? name(expr);
    if (["Option.Some", "Option.None", "Some", "None"].includes(h ?? "")) return true;
    const type = expressionType(expr, bindings);
    return type !== undefined && head(resolve(type)) === "Option";
  };
  const numericKindFromType = (type: SExpr | undefined): NumericKind => {
    if (!type) return undefined;
    const resolved = resolve(type);
    const resolvedName = name(resolved);
    if (resolvedName === "Float") return "Float";
    if (resolvedName === "Int") return "Int";
    return "NonNumeric";
  };
  const numericKind = (expr: SExpr, bindings: TypeBindings): NumericKind => {
    if (expr._tag === "Num") return isFloatLiteral(expr) ? "Float" : "Int";
    if (expr._tag === "Str" || expr._tag === "Bool" || expr._tag === "Vector" || expr._tag === "Map" || expr._tag === "Set") {
      return "NonNumeric";
    }
    if (expr._tag === "Sym") {
      if (expr.name === "nil" || expr.name.startsWith(":")) return "NonNumeric";
      const declared = expressionType(expr, bindings);
      if (declared) return numericKindFromType(declared);
      const def = definitions.get(expr.name);
      if (def && !resolving.has(expr.name)) {
        resolving.add(expr.name);
        try { return numericKind(def, bindings); } finally { resolving.delete(expr.name); }
      }
      return undefined;
    }
    if (expr._tag !== "List") return undefined;
    const h = head(expr);
    if (h === "__float") return "Float";
    if (h === "fn" || h === "quote" || h === "quasiquote" || h === "succeed" || h === "fail" || h === "__dictionary" || h === "__macro") {
      return "NonNumeric";
    }
    if (h === ":" && expr.items.length === 3) return numericKindFromType(expr.items[2]);
    if (h === "do") return expr.items.length > 1 ? numericKind(expr.items.at(-1)!, bindings) : "NonNumeric";
    if (h === "let" && expr.items[1]?._tag === "Vector" && expr.items.length >= 3) {
      const locals = new Map(bindings);
      const values = expr.items[1].items;
      for (let i = 0; i < values.length; i += 2) {
        const key = name(values[i]);
        const value = values[i + 1];
        if (!key || !value) continue;
        const type = expressionType(value, locals);
        if (type) {
          locals.set(key, type);
        } else {
          const kind = numericKind(value, locals);
          if (kind === "Float" || kind === "Int") locals.set(key, sym(value, kind));
        }
      }
      return numericKind(expr.items.at(-1)!, locals);
    }
    if (h === "if") {
      if (expr.items.length !== 4) return "NonNumeric";
      return joinNumericKinds([numericKind(expr.items[2]!, bindings), numericKind(expr.items[3]!, bindings)]);
    }
    if (h === "match") {
      const branches = expr.items.filter((_, i) => i >= 3 && i % 2 === 1);
      return branches.length ? joinNumericKinds(branches.map((branch) => numericKind(branch, bindings))) : "NonNumeric";
    }
    if (h && !bindings.has(h) && !definitions.has(h)) {
      if (FLOAT_RETURN_OPS.has(h)) return "Float";
      if (INT_RETURN_OPS.has(h)) return "Int";
      if (POLYMORPHIC_NUMERIC_OPS.has(h)) {
        const argKinds = expr.items.slice(1).map((arg) => numericKind(arg, bindings));
        if (argKinds.some((k) => k === "Float")) return "Float";
        if (argKinds.length > 0 && argKinds.every((k) => k === "Int")) return "Int";
        return undefined;
      }
      if (NON_NUMERIC_OPS.has(h)) return "NonNumeric";
    }
    const declared = expressionType(expr, bindings);
    if (declared) return numericKindFromType(declared);
    const definition = h ? definitions.get(h) : undefined;
    if (h && definition && !resolving.has(h)) {
      resolving.add(h);
      try {
        const locals = new Map(bindings);
        if (head(definition) === "fn" && definition._tag === "List" && definition.items[1]?._tag === "Vector") {
          definition.items[1].items.forEach((param, i) => {
            const paramName = name(param);
            const arg = expr.items[i + 1];
            if (!paramName || !arg) return;
            const type = expressionType(arg, bindings);
            if (type) locals.set(paramName, type);
            else {
              const kind = numericKind(arg, bindings);
              if (kind === "Float" || kind === "Int") locals.set(paramName, sym(arg, kind));
            }
          });
          return numericKind(definition.items.at(-1)!, locals);
        }
        return numericKind(definition, locals);
      } finally { resolving.delete(h); }
    }
    return undefined;
  };
  const coerceBranchToFloat = (expr: SExpr, bindings: TypeBindings): SExpr => {
    if (numericKind(expr, bindings) === "Float") return expr;
    if (expr._tag === "List") {
      const h = head(expr);
      if (h === "if" && expr.items.length === 4) {
        const thenBranch = coerceBranchToFloat(expr.items[2]!, bindings);
        const elseBranch = coerceBranchToFloat(expr.items[3]!, bindings);
        if (thenBranch === expr.items[2] && elseBranch === expr.items[3]) return expr;
        return copySourceTrace(expr, { ...expr, items: [expr.items[0]!, expr.items[1]!, thenBranch, elseBranch] });
      }
      if (h === "do" && expr.items.length >= 2) {
        const last = coerceBranchToFloat(expr.items.at(-1)!, bindings);
        if (last === expr.items.at(-1)) return expr;
        return copySourceTrace(expr, { ...expr, items: [...expr.items.slice(0, -1), last] });
      }
      if (h === "let" && expr.items[1]?._tag === "Vector" && expr.items.length >= 3) {
        const locals = new Map(bindings);
        const values = expr.items[1].items;
        for (let i = 0; i < values.length; i += 2) {
          const key = name(values[i]);
          const value = values[i + 1];
          if (!key || !value) continue;
          const type = expressionType(value, locals);
          if (type) locals.set(key, type);
          else {
            const kind = numericKind(value, locals);
            if (kind === "Float" || kind === "Int") locals.set(key, sym(value, kind));
          }
        }
        const last = coerceBranchToFloat(expr.items.at(-1)!, locals);
        if (last === expr.items.at(-1)) return expr;
        return copySourceTrace(expr, { ...expr, items: [...expr.items.slice(0, -1), last] });
      }
      if (h === "match" && expr.items.length >= 4) {
        let changed = false;
        const items = expr.items.map((value, i) => {
          if (i < 3 || i % 2 !== 1) return value;
          const coerced = coerceBranchToFloat(value, bindings);
          if (coerced !== value) changed = true;
          return coerced;
        });
        return changed ? copySourceTrace(expr, { ...expr, items }) : expr;
      }
    }
    return call(expr, "__float", expr);
  };
  const transform = (expr: SExpr, expected: SExpr | undefined, bindings: TypeBindings): SExpr => {
    const target = expected ? resolve(expected) : undefined;
    if (!numericOnly && target && head(target) === "Map" && expr._tag !== "Map" && head(expr) !== "__dictionary" && !["if", "let", "do", "match", ":"].includes(head(expr) ?? "")) {
      return call(expr, "__dictionary", visit(expr, undefined, bindings));
    }
    const recurse = (value: SExpr, type?: SExpr) => visit(value, type, bindings);
    if (!numericOnly && target?._tag === "List" && head(target) === "Option" && !isOption(expr, bindings)
      && !["if", "match", "let", "do"].includes(head(expr) ?? "")) {
      return call(expr, "Option.Some", recurse(expr, target.items[1]));
    }
    if (expr._tag === "Map") {
      if (numericOnly) {
        return { ...expr, pairs: expr.pairs.map(([key, value]) => [key, recurse(value)] as const) };
      }
      const declared = target?._tag === "Map" ? target.pairs : [];
      const pairs = expr.pairs.map(([key, value]) => {
        const field = declared.find(([label]) => fieldName(label) === fieldName(key))?.[1];
        const fieldType = field ? resolve(field) : undefined;
        if (fieldType?._tag === "List" && head(fieldType) === "Option") {
          return [key, recurse(value, fieldType)] as const;
        }
        return [key, recurse(value, field)] as const;
      });
      for (const [key, field] of declared) {
        if (head(resolve(field)) === "Option" && !pairs.some(([label]) => fieldName(label) === fieldName(key))) {
          pairs.push([key, sym(expr, "Option.None")]);
        }
      }
      const record: SExpr = { ...expr, pairs };
      return target && head(target) === "Map" ? call(expr, "__dictionary", record) : record;
    }
    if (expr._tag === "Vector") {
      const item = !numericOnly && target?._tag === "List" && head(target) === "List" ? target.items[1] : undefined;
      return { ...expr, items: expr.items.map(value => recurse(value, item)) };
    }
    if (expr._tag !== "List" || ["quote", "quasiquote", "__sum-type", "__type-alias", "__record-type", "__schema", "__macro"].includes(head(expr) ?? "")) return expr;
    const h = head(expr);
    if (h === ":" && name(expr.items[1]) && signatures.has(name(expr.items[1])!)) return expr;
    if (h === ":" && expr.items.length === 3) return { ...expr, items: [expr.items[0]!, recurse(expr.items[1]!, expr.items[2]), expr.items[2]!] };
    if (h === "define" && name(expr.items[1]) && expr.items[2]) {
      return { ...expr, items: [expr.items[0]!, expr.items[1]!, recurse(expr.items[2], signatures.get(name(expr.items[1])!))] };
    }
    if (h === "fn" && target?._tag === "List" && head(target) === "->") {
      const locals = new Map(bindings);
      const params = expr.items[1];
      if (params?._tag === "Vector") params.items.forEach((param, i) => {
        if (name(param) && target.items[i + 1]) locals.set(name(param)!, target.items[i + 1]!);
      });
      return { ...expr, items: [...expr.items.slice(0, 2), ...expr.items.slice(2).map((value, i, bodies) => visit(value, i === bodies.length - 1 ? target.items.at(-1) : undefined, locals))] };
    }
    if (h === "let" && expr.items[1]?._tag === "Vector") {
      const locals = new Map(bindings);
      const values = expr.items[1].items;
      const items: SExpr[] = [];
      for (let i = 0; i < values.length; i += 2) {
        const pattern = values[i]!, value = values[i + 1];
        if (!value) return expr;
        const visited = visit(value, undefined, locals);
        items.push(pattern, visited);
        const bindName = name(pattern);
        if (bindName) {
          const type = expressionType(visited, locals);
          if (type) locals.set(bindName, type);
          else {
            const kind = numericKind(visited, locals);
            if (kind === "Float" || kind === "Int") locals.set(bindName, sym(visited, kind));
          }
        }
      }
      return { ...expr, items: [expr.items[0]!, copySourceTrace(expr.items[1], { ...expr.items[1], items }), ...expr.items.slice(2).map((value, i, bodies) => visit(value, i === bodies.length - 1 ? target : undefined, locals))] };
    }
    if (h === "if") {
      const items = expr.items.map((value, i) => i > 1 ? recurse(value, target) : i === 1 ? recurse(value) : value);
      if (items.length === 4) {
        const thenKind = numericKind(items[2]!, bindings);
        const elseKind = numericKind(items[3]!, bindings);
        if ((thenKind === "Float" || elseKind === "Float") && thenKind !== "NonNumeric" && elseKind !== "NonNumeric") {
          items[2] = coerceBranchToFloat(items[2]!, bindings);
          items[3] = coerceBranchToFloat(items[3]!, bindings);
        }
      }
      return { ...expr, items };
    }
    if (h === "do") return { ...expr, items: expr.items.map((value, i) => i === expr.items.length - 1 ? recurse(value, target) : i > 0 ? recurse(value) : value) };
    if (h === "match") {
      const items = expr.items.map((value, i) => i === 1 ? recurse(value) : i >= 3 && i % 2 === 1 ? recurse(value, target) : value);
      if (items.length >= 4) {
        const branchKinds = items.filter((_, i) => i >= 3 && i % 2 === 1).map((value) => numericKind(value, bindings));
        if (branchKinds.some((k) => k === "Float") && !branchKinds.some((k) => k === "NonNumeric")) {
          for (let i = 3; i < items.length; i += 2) {
            items[i] = coerceBranchToFloat(items[i]!, bindings);
          }
        }
      }
      return { ...expr, items };
    }
    const parameters = numericOnly ? [] : constructors.get(h ?? "") ?? ((bindings.get(h ?? "") ?? signatures.get(h ?? ""))?._tag === "List"
      ? ((bindings.get(h ?? "") ?? signatures.get(h ?? "")) as Extract<SExpr, { _tag: "List" }>).items.slice(1, -1) : []);
    return { ...expr, items: [expr.items[0]!, ...expr.items.slice(1).map((value, i) => recurse(value, parameters[i]))] };
  };
  const visit = (expr: SExpr, expected?: SExpr, bindings: TypeBindings = signatures): SExpr => {
    const result = transform(expr, expected, bindings);
    if (result === expr) return expr;
    if ((expr._tag === "List" || expr._tag === "Vector") && result._tag === expr._tag
      && result.items.length === expr.items.length && result.items.every((item, i) => item === expr.items[i])) return expr;
    if (expr._tag === "Map" && result._tag === "Map" && result.pairs.length === expr.pairs.length
      && result.pairs.every(([key, value], i) => key === expr.pairs[i]![0] && value === expr.pairs[i]![1])) return expr;
    return copySourceTrace(expr, result);
  };
  return exprs.map(expr => visit(expr));
}
