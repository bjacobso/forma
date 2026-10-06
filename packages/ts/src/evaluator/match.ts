import { KKeyword, mapKey, quotedDatum } from "./types.js";
import type { SExpr } from "../reader/index.js";
import { KernelTypeError } from "../diagnostic/errors.js";
import { sourceTraceOf, type SourceTrace } from "./source-trace.js";
import { kEquals, type KValue } from "./types.js";

export type MatchPattern =
  | { readonly _tag: "Literal"; readonly value: KValue }
  | { readonly _tag: "Wildcard" }
  | { readonly _tag: "Binding"; readonly bindingIndex: number }
  | { readonly _tag: "Constructor"; readonly name: string; readonly items: readonly MatchPattern[] }
  | { readonly _tag: "Seq"; readonly items: readonly MatchPattern[]; readonly rest?: MatchPattern }
  | {
      readonly _tag: "Map";
      readonly as?: MatchPattern;
      readonly entries: readonly {
        readonly key: string;
        readonly pattern: MatchPattern;
      }[];
    };

export interface CompiledMatchPattern {
  readonly pattern: MatchPattern;
  readonly bindingNames: readonly string[];
}

const patternCache = new WeakMap<SExpr, CompiledMatchPattern>();
const UNBOUND = Symbol("forma/match-unbound");

export function compileMatchPattern(
  expr: SExpr,
  trace: SourceTrace = sourceTraceOf(expr),
): CompiledMatchPattern {
  const cached = patternCache.get(expr);
  if (cached) {
    return cached;
  }

  const bindingNames: string[] = [];
  const bindingIndices = new Map<string, number>();
  const pattern = compilePatternNode(expr, bindingNames, bindingIndices, trace);
  const compiled = { pattern, bindingNames } satisfies CompiledMatchPattern;
  patternCache.set(expr, compiled);
  return compiled;
}

export function matchCompiledPattern(
  compiled: CompiledMatchPattern,
  value: KValue,
  constructorSpec: (name: string) => KValue | undefined = () => undefined,
): readonly KValue[] | null {
  const bindings = new Array<KValue | typeof UNBOUND>(compiled.bindingNames.length).fill(UNBOUND);
  return matchPatternNode(compiled.pattern, value, bindings, constructorSpec)
    ? (bindings as readonly KValue[])
    : null;
}

function compilePatternNode(
  expr: SExpr,
  bindingNames: string[],
  bindingIndices: Map<string, number>,
  trace: SourceTrace,
): MatchPattern {
  switch (expr._tag) {
    case "Num":
      return { _tag: "Literal", value: expr.value };

    case "Str":
      return { _tag: "Literal", value: expr.value };

    case "Bool":
      return { _tag: "Literal", value: expr.value };

    case "Sym": {
      if (expr.name === "_") {
        return { _tag: "Wildcard" };
      }
      if (expr.name === "nil") {
        return { _tag: "Literal", value: null };
      }
      if (expr.name === "true") {
        return { _tag: "Literal", value: true };
      }
      if (expr.name === "false") {
        return { _tag: "Literal", value: false };
      }
      if (expr.name.startsWith(":")) {
        return { _tag: "Literal", value: KKeyword(expr.name) };
      }

      if (/^[A-Z]/.test(expr.name)) return { _tag: "Constructor", name: expr.name, items: [] };
      const existingIndex = bindingIndices.get(expr.name);
      if (existingIndex !== undefined) {
        return { _tag: "Binding", bindingIndex: existingIndex };
      }

      const bindingIndex = bindingNames.length;
      bindingNames.push(expr.name);
      bindingIndices.set(expr.name, bindingIndex);
      return { _tag: "Binding", bindingIndex };
    }

    case "List":
      if (expr.items[0]?._tag === "Sym" && /^[A-Z]/.test(expr.items[0].name)) {
        return { _tag: "Constructor", name: expr.items[0].name, items: expr.items.slice(1).map(item => compilePatternNode(item, bindingNames, bindingIndices, trace)) };
      }
      return {
        _tag: "Seq",
        items: expr.items.map((item) =>
          compilePatternNode(item, bindingNames, bindingIndices, trace),
        ),
      };

    case "Vector": {
      const restIndex = expr.items.findIndex(i => i._tag === "Sym" && i.name === "&");
      if (restIndex >= 0 && restIndex !== expr.items.length - 2) throw new KernelTypeError({ message: "& must precede one final rest pattern", expected: "[patterns & rest]", got: "invalid rest pattern", loc: expr.loc });
      return { _tag: "Seq", items: (restIndex < 0 ? expr.items : expr.items.slice(0, restIndex)).map(i => compilePatternNode(i, bindingNames, bindingIndices, trace)), ...(restIndex < 0 ? {} : { rest: compilePatternNode(expr.items[restIndex + 1]!, bindingNames, bindingIndices, trace) }) };
    }

    case "Map":
      return {
        _tag: "Map",
        ...(expr.pairs.some(([k])=>k._tag === "Sym" && k.name === ":as") ? {as:compilePatternNode(expr.pairs.find(([k])=>k._tag === "Sym" && k.name === ":as")![1],bindingNames,bindingIndices,trace)} : {}),
        entries: expr.pairs.filter(([k])=>!(k._tag === "Sym" && k.name === ":as")).flatMap(([k, v]) => k._tag === "Sym" && k.name === ":keys" && v._tag === "Vector" ? v.items.map(a => [{ _tag: "Sym" as const, name: `:${a._tag === "Sym" ? a.name : ""}`, loc: a.loc }, a] as const) : [[k, v] as const]).map(([keyExpr, valueExpr]) => ({
          key: compileMapPatternKey(keyExpr, trace),
          pattern: compilePatternNode(valueExpr, bindingNames, bindingIndices, trace),
        })),
      };

    case "Set":
      throw new KernelTypeError({
        message: "match patterns do not support set literals",
        expected: "literal, symbol, list, vector, or map pattern",
        got: "set literal",
        loc: trace.loc,
        ...(trace.macroOrigins ? { macroOrigins: trace.macroOrigins } : {}),
      });

    case "Error":
      throw new KernelTypeError({
        message: `Invalid match pattern: ${expr.message}`,
        expected: "valid pattern",
        got: "parse error",
        loc: trace.loc,
        ...(trace.macroOrigins ? { macroOrigins: trace.macroOrigins } : {}),
      });
  }
}

function compileMapPatternKey(expr: SExpr, trace: SourceTrace): string {
  if (expr._tag === "Str") {
    return mapKey(expr.value)!;
  }
  if (expr._tag === "Sym" && expr.name.startsWith(":")) {
    return expr.name;
  }

  throw new KernelTypeError({
    message: "match map pattern keys must be string or keyword literals",
    expected: "string or keyword literal",
    got: expr._tag === "Sym" ? expr.name : expr._tag,
    loc: trace.loc,
    ...(trace.macroOrigins ? { macroOrigins: trace.macroOrigins } : {}),
  });
}

function matchPatternNode(
  pattern: MatchPattern,
  value: KValue,
  bindings: (KValue | typeof UNBOUND)[],
  constructorSpec: (name: string) => KValue | undefined,
): boolean {
  switch (pattern._tag) {
    case "Literal":
      return kEquals(pattern.value, value);

    case "Wildcard":
      return true;

    case "Binding": {
      const existing = bindings[pattern.bindingIndex];
      if (existing === UNBOUND) {
        bindings[pattern.bindingIndex] = value;
        return true;
      }
      return kEquals(existing as KValue, value);
    }

    case "Constructor": {
      const spec = constructorSpec(pattern.name);
      const discriminator = spec instanceof Map ? spec.get(":discriminator") : "_tag";
      const arity = spec instanceof Map ? spec.get(":arity") : pattern.items.length;
      if (!(value instanceof Map) || (!(spec instanceof Map && spec.get(":class") === true) && value.get(`:${String(discriminator)}`) !== pattern.name.split(".").at(-1)) || arity !== pattern.items.length) return false;
      if (spec instanceof Map && spec.get(":class") === true) {
        const fields = spec.get(":fields");
        if (Array.isArray(fields) && fields.some(key => !value.has(mapKey(key)!))) return false;
      }
      const payload = spec instanceof Map && spec.get(":record") === true ? [value] : arity === 0 ? [] : arity === 1 ? [value.get(":value") ?? null] : value.get(":values");
      return Array.isArray(payload) && pattern.items.every((p,i)=>matchPatternNode(p,payload[i]!,bindings,constructorSpec));
    }
    case "Seq":
      return (
        Array.isArray(value) &&
        (pattern.rest ? value.length >= pattern.items.length : value.length === pattern.items.length) &&
        pattern.items.every((item, index) => matchPatternNode(item, value[index]!, bindings, constructorSpec)) &&
        (!pattern.rest || matchPatternNode(pattern.rest, value.slice(pattern.items.length), bindings, constructorSpec))
      );

    case "Map":
      return (
        value instanceof Map &&
        (!pattern.as || matchPatternNode(pattern.as,value,bindings,constructorSpec)) &&
        pattern.entries.every((entry) => {
          if (!value.has(entry.key)) {
            return false;
          }
          return matchPatternNode(entry.pattern, value.get(entry.key) ?? null, bindings, constructorSpec);
        })
      );
  }
}
