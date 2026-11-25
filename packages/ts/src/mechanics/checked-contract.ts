/**
 * Solver-neutral contract between an Effect program typechecker (legacy
 * `mechanics/check.ts` or unified HM `type/infer-program.ts`) and downstream
 * IR projection / Effect TypeScript / Effect Schema code generation.
 *
 * This module intentionally has zero dependency on `mechanics/check.ts` or
 * `mechanics/builtins.ts`.
 *
 * @module
 */
import type { JsonValue, PackageableDeclaration } from "../artifact/artifact.js";
import {
  arrayItems,
  isRecord,
  prim,
  tBool,
  tInt,
  tNumber,
  tString,
  type LayerType,
  type MField,
  type MType,
  type TypeEnvironment,
} from "./types.js";

/** Effect / stdlib module names that builtin emission callbacks may request. */
export type BuiltinImportName = "Duration" | "Option" | "Record" | "Schedule";

/** TypeScript operator precedences used by expression and builtin emission. */
export const Precedence = {
  Arrow: 2,
  Conditional: 3,
  Or: 4,
  And: 5,
  Equality: 9,
  Relational: 10,
  Additive: 12,
  Multiplicative: 13,
  Unary: 15,
  Postfix: 20,
} as const;

/** A translated argument and the precedence of its outermost operator. */
export interface BuiltinEmitArg {
  readonly code: string;
  readonly prec: number;
}

/** Callbacks provided by the Effect TypeScript emitter to a builtin translator. */
export interface BuiltinEmitContext {
  readonly use: (name: BuiltinImportName) => void;
  /** The TypeScript type of the call's result, for translations that need an explicit type argument. */
  readonly resultType: () => string;
  /** An identifier for a binder the translation introduces, distinct from every visible name. */
  readonly fresh: (preferred: string) => string;
}

/** Solver-neutral emission contract for a resolved builtin overload. */
export interface BuiltinEmission {
  readonly params: readonly MType[];
  readonly result: MType;
  readonly emit: (args: readonly BuiltinEmitArg[], context: BuiltinEmitContext) => string;
  /** Precedence of the emitted expression; calls and member access by default. */
  readonly prec?: number;
  /** Arguments the translation gives a contextual type (for example through an annotated thunk). */
  readonly contextualArgs?: readonly number[];
}

/** An arrow function body; object literals need parentheses. */
export function arrowBody(code: string): string {
  return code.startsWith("{") ? `(${code})` : code;
}

const emitArg = (value: BuiltinEmitArg | undefined): string => value?.code ?? "undefined";
const emitOperand = (value: BuiltinEmitArg | undefined, prec: number): string =>
  value === undefined ? "undefined" : value.prec < prec ? `(${value.code})` : value.code;
const emitReceiver = (value: BuiltinEmitArg | undefined): string => emitOperand(value, Precedence.Postfix);
const bVar = (id: number): MType => ({ kind: "var", id });
const bArray = (item: MType): MType => ({ kind: "array", item });
const bOption = (item: MType): MType => ({ kind: "option", item });
const bMap = (value: MType): MType => ({ kind: "map", value });
const bFn = (params: readonly MType[], result: MType): MType => ({ kind: "function", params, result });
const emitCall = (callee: string, ...args: readonly (BuiltinEmitArg | undefined)[]): string =>
  `${callee}(${args.map(emitArg).join(", ")})`;
const optionFromUndefined = (expression: string, context: BuiltinEmitContext): string => {
  context.use("Option");
  return `Option.fromUndefinedOr(${expression})`;
};
const recordCall = (name: string) => (args: readonly BuiltinEmitArg[], context: BuiltinEmitContext): string => {
  context.use("Record");
  return emitCall(`Record.${name}`, ...args);
};
const binaryEmit = (operator: string, prec: number) => ([a, b]: readonly BuiltinEmitArg[]): string =>
  `${emitOperand(a, prec)} ${operator} ${emitOperand(b, prec + 1)}`;

/** Solver-neutral builtin emission overloads for Effect TypeScript codegen. */
export const builtinEmissions: ReadonlyMap<string, readonly BuiltinEmission[]> = new Map<
  string,
  readonly BuiltinEmission[]
>([
  ["mod", [{ params: [tInt, tInt], result: tInt, emit: binaryEmit("%", Precedence.Multiplicative), prec: Precedence.Multiplicative }]],
  ["/", [{ params: [tNumber, tNumber], result: tNumber, emit: binaryEmit("/", Precedence.Multiplicative), prec: Precedence.Multiplicative }]],
  ["quot", [{ params: [tInt, tInt], result: tInt, emit: (args) => `Math.trunc(${binaryEmit("/", Precedence.Multiplicative)(args)})` }]],
  ...(["<", "<=", ">", ">="] as const).map(
    (op): [string, readonly BuiltinEmission[]] => [
      op,
      [{ params: [tNumber, tNumber], result: tBool, emit: binaryEmit(op, Precedence.Relational), prec: Precedence.Relational }],
    ],
  ),
  ["not", [{ params: [tBool], result: tBool, emit: ([a]) => `!${emitOperand(a, Precedence.Unary)}`, prec: Precedence.Unary }]],
  [
    "count",
    [
      { params: [bArray(bVar(0))], result: tInt, emit: ([a]) => `${emitReceiver(a)}.length` },
      { params: [tString], result: tInt, emit: ([a]) => `${emitReceiver(a)}.length` },
    ],
  ],
  ["empty?", [{ params: [bArray(bVar(0))], result: tBool, emit: ([a]) => `${emitReceiver(a)}.length === 0`, prec: Precedence.Equality }]],
  ["map", [{ params: [bFn([bVar(0)], bVar(1)), bArray(bVar(0))], result: bArray(bVar(1)), emit: ([f, xs]) => emitCall(`${emitReceiver(xs)}.map`, f) }]],
  ["filter", [{ params: [bFn([bVar(0)], tBool), bArray(bVar(0))], result: bArray(bVar(0)), emit: ([f, xs]) => emitCall(`${emitReceiver(xs)}.filter`, f) }]],
  ["reverse", [{ params: [bArray(bVar(0))], result: bArray(bVar(0)), emit: ([xs]) => `[...${emitReceiver(xs)}].reverse()` }]],
  ["sqrt", [{ params: [tNumber], result: tNumber, emit: ([x]) => emitCall("Math.sqrt", x) }]],
  [
    "reduce",
    [
      {
        params: [bFn([bVar(1), bVar(0)], bVar(1)), bVar(1), bArray(bVar(0))],
        result: bVar(1),
        emit: ([f, init, xs], context) => emitCall(`${emitReceiver(xs)}.reduce<${context.resultType()}>`, f, init),
      },
    ],
  ],
  [
    "find",
    [
      {
        params: [bFn([bVar(0)], tBool), bArray(bVar(0))],
        result: bOption(bVar(0)),
        emit: ([f, xs], context) => optionFromUndefined(emitCall(`${emitReceiver(xs)}.find`, f), context),
      },
    ],
  ],
  ["any?", [{ params: [bFn([bVar(0)], tBool), bArray(bVar(0))], result: tBool, emit: ([f, xs]) => emitCall(`${emitReceiver(xs)}.some`, f) }]],
  ["every?", [{ params: [bFn([bVar(0)], tBool), bArray(bVar(0))], result: tBool, emit: ([f, xs]) => emitCall(`${emitReceiver(xs)}.every`, f) }]],
  [
    "concat",
    [
      { params: [bArray(bVar(0)), bArray(bVar(0))], result: bArray(bVar(0)), emit: ([a, b]) => `[...${emitReceiver(a)}, ...${emitReceiver(b)}]` },
    ],
  ],
  ["conj", [{ params: [bArray(bVar(0)), bVar(0)], result: bArray(bVar(0)), emit: ([xs, x]) => `[...${emitReceiver(xs)}, ${emitArg(x)}]` }]],
  [
    "first",
    [{ params: [bArray(bVar(0))], result: bOption(bVar(0)), emit: ([xs], context) => optionFromUndefined(`${emitReceiver(xs)}[0]`, context) }],
  ],
  ["keys", [{ params: [bMap(bVar(0))], result: bArray(tString), emit: recordCall("keys") }]],
  ["vals", [{ params: [bMap(bVar(0))], result: bArray(bVar(0)), emit: recordCall("values") }]],
  ["dissoc", [{ params: [bMap(bVar(0)), tString], result: bMap(bVar(0)), emit: recordCall("remove") }]],
  ["has-key?", [{ params: [bMap(bVar(0)), tString], result: tBool, emit: recordCall("has") }]],
  ["upcase", [{ params: [tString], result: tString, emit: ([s]) => `${emitReceiver(s)}.toUpperCase()` }]],
  ["downcase", [{ params: [tString], result: tString, emit: ([s]) => `${emitReceiver(s)}.toLowerCase()` }]],
  ["trim", [{ params: [tString], result: tString, emit: ([s]) => `${emitReceiver(s)}.trim()` }]],
  ["starts-with?", [{ params: [tString, tString], result: tBool, emit: ([s, p]) => emitCall(`${emitReceiver(s)}.startsWith`, p) }]],
  ["ends-with?", [{ params: [tString, tString], result: tBool, emit: ([s, p]) => emitCall(`${emitReceiver(s)}.endsWith`, p) }]],
  [
    "includes?",
    [
      { params: [tString, tString], result: tBool, emit: ([s, p]) => emitCall(`${emitReceiver(s)}.includes`, p) },
      { params: [bArray(bVar(0)), bVar(0)], result: tBool, emit: ([xs, x]) => emitCall(`${emitReceiver(xs)}.includes`, x) },
    ],
  ],
  ["split", [{ params: [tString, tString], result: bArray(tString), emit: ([s, sep]) => emitCall(`${emitReceiver(s)}.split`, sep) }]],
  ["join", [{ params: [bArray(tString), tString], result: tString, emit: ([xs, sep]) => emitCall(`${emitReceiver(xs)}.join`, sep) }]],
  [
    "get-or-else",
    [
      {
        params: [bOption(bVar(0)), bVar(0)],
        result: bVar(0),
        contextualArgs: [1],
        emit: ([o, d], context) => {
          context.use("Option");
          return `Option.getOrElse(${emitArg(o)}, (): ${context.resultType()} => ${arrowBody(emitArg(d))})`;
        },
      },
    ],
  ],
  ...(["is-some", "is-none"] as const).map(
    (name): [string, readonly BuiltinEmission[]] => [
      name,
      [
        {
          params: [bOption(bVar(0))],
          result: tBool,
          emit: ([o], context) => {
            context.use("Option");
            return emitCall(name === "is-some" ? "Option.isSome" : "Option.isNone", o);
          },
        },
      ],
    ],
  ),
  ...(["millis", "seconds", "minutes"] as const).map(
    (unit): [string, readonly BuiltinEmission[]] => [
      unit,
      [
        {
          params: [tNumber],
          result: prim("Duration"),
          emit: ([n], context) => {
            context.use("Duration");
            return emitCall(`Duration.${unit}`, n);
          },
        },
      ],
    ],
  ),
  ...(["spaced", "exponential", "fixed"] as const).map(
    (name): [string, readonly BuiltinEmission[]] => [
      name,
      [tNumber, prim("Duration")].map((param) => ({
        params: [param],
        result: prim("Schedule"),
        emit: ([duration]: readonly BuiltinEmitArg[], context: BuiltinEmitContext) => {
          context.use("Schedule");
          return emitCall(`Schedule.${name}`, duration);
        },
      })),
    ],
  ),
  ...(["recurs", "jittered"] as const).map(
    (name): [string, readonly BuiltinEmission[]] => [
      name,
      [
        {
          params: [name === "recurs" ? tInt : prim("Schedule")],
          result: prim("Schedule"),
          emit: ([value], context) => {
            context.use("Schedule");
            return emitCall(`Schedule.${name}`, value);
          },
        },
      ],
    ],
  ),
  ["to-string", [{ params: [bVar(0)], result: tString, emit: ([a]) => emitCall("String", a) }]],
  [
    "abs",
    [
      { params: [tInt], result: tInt, emit: ([a]) => emitCall("Math.abs", a) },
      { params: [tNumber], result: tNumber, emit: ([a]) => emitCall("Math.abs", a) },
    ],
  ],
  ["round", [{ params: [tNumber], result: tInt, emit: ([a]) => `Math.floor(${emitArg(a)} + 0.5)` }]],
  ["ceil", [{ params: [tNumber], result: tInt, emit: ([a]) => emitCall("Math.ceil", a) }]],
  ["floor", [{ params: [tNumber], result: tInt, emit: ([a]) => emitCall("Math.floor", a) }]],
  [
    "sum",
    [tInt, tNumber].map((item) => ({
      params: [bArray(item)],
      result: item,
      emit: ([xs]: readonly BuiltinEmitArg[], context: BuiltinEmitContext) => {
        const total = context.fresh("total");
        const value = context.fresh("item");
        return `${emitReceiver(xs)}.reduce((${total}, ${value}) => ${total} + ${value}, 0)`;
      },
    })),
  ],
]);

/** Variadic numeric operators: `Int` when every operand is `Int`. */
export const builtinArithmeticOperators: ReadonlyMap<string, string> = new Map([
  ["+", "+"],
  ["-", "-"],
  ["*", "*"],
  ["/", "/"],
  ["max", "max"],
  ["min", "min"],
]);

/** Errors that Effect itself can raise from the combinators Forma exposes. */
export const builtinErrors: ReadonlyMap<string, string> = new Map([
  ["TimeoutError", "Cause.TimeoutError"],
  ["ConfigError", "Config.ConfigError"],
  ["SchemaError", "Schema.SchemaError"],
]);

/** Requirements that are not services. */
export const builtinRequirements: ReadonlySet<string> = new Set(["Scope"]);

export interface CheckedEffectSourceSpan {
  readonly sourceId: string;
  readonly startOffset: number;
  readonly endOffset: number;
}

export interface CheckedEffectDiagnostic {
  readonly details?: Readonly<Record<string, unknown>> | undefined;
  readonly code: string;
  readonly message: string;
  readonly severity: "error" | "warning" | "info";
  readonly span?: CheckedEffectSourceSpan | undefined;
  readonly help?: string | undefined;
  readonly fix?: readonly { readonly span: CheckedEffectSourceSpan; readonly newText: string }[] | undefined;
}

export type EffectType = MType & { readonly kind: "effect" };

/** How a value-position application was resolved by the checker. */
export type ResolvedCall =
  | { readonly kind: "builtin"; readonly name: string; readonly overload: BuiltinEmission }
  | { readonly kind: "arithmetic"; readonly operator: string }
  | { readonly kind: "equality"; readonly operator: "=" | "!=" }
  | { readonly kind: "special"; readonly name: string }
  | { readonly kind: "get"; readonly access: "field" | "optional-field" | "map" }
  | { readonly kind: "assoc"; readonly access: "field" | "map" | "class" }
  | { readonly kind: "class"; readonly name: string }
  | { readonly kind: "stream"; readonly name: string }
  | { readonly kind: "error"; readonly name: string }
  | { readonly kind: "brand"; readonly name: string }
  | { readonly kind: "construct"; readonly name: string }
  | { readonly kind: "tagged-constructor"; readonly owner: string; readonly name: string; readonly nullary: boolean }
  | { readonly kind: "function"; readonly name: string }
  | { readonly kind: "operation"; readonly name: string }
  | { readonly kind: "service"; readonly service: string; readonly method: string }
  | { readonly kind: "local"; readonly name: string };

export type MatchShape =
  | { readonly kind: "option" }
  | { readonly kind: "result" }
  | { readonly kind: "literal" }
  | { readonly kind: "tagged"; readonly discriminator: string };

export interface ServiceMethodSignature {
  readonly value?: boolean;
  readonly name: string;
  readonly params: readonly { readonly name: string; readonly type: MType }[];
  readonly effect: EffectType;
}

export interface CallableSignature {
  readonly params: readonly { readonly name: string; readonly type: MType }[];
  readonly result: MType;
}

export type CheckedOperationSignature = CallableSignature & { readonly result: EffectType };

export interface LayerInfo {
  readonly type: LayerType;
  /** Services that operation calls inside methods need from the captured context. */
  readonly contextServices: readonly string[];
}

/**
 * Checked metadata tables needed by Effect TypeScript codegen.
 * WeakMap/WeakSet keys are the IR nodes inside `CheckedEffectProgram.declarations`.
 */
export interface CheckedEffectInfo {
  readonly env: TypeEnvironment;
  readonly errorFields: ReadonlyMap<string, readonly MField[]>;
  readonly services: ReadonlyMap<string, ReadonlyMap<string, ServiceMethodSignature>>;
  readonly operations: ReadonlyMap<string, CheckedOperationSignature>;
  readonly functions: ReadonlyMap<string, CallableSignature>;
  readonly constants: ReadonlyMap<string, MType>;
  readonly layers: ReadonlyMap<string, LayerInfo>;
  readonly valueTypes: WeakMap<object, MType>;
  readonly effectTypes: WeakMap<object, EffectType>;
  readonly calls: WeakMap<object, ResolvedCall>;
  readonly matches: WeakMap<object, MatchShape>;
  /** Record literals checked against an expected record type. */
  readonly recordTargets: WeakMap<object, MType>;
  /** Literal syntax (strings, numbers, booleans, keywords, records, vectors) checked against a type with literal types. */
  readonly literalTargets: WeakMap<object, MType>;
  /** Operation calls inside layer methods that must be given the layer's captured context. */
  readonly contextCalls: WeakSet<object>;
}

/**
 * Solver-neutral checked Effect program passed into Effect TypeScript and
 * Effect Schema code generators.
 */
export interface CheckedEffectProgram {
  readonly ok: boolean;
  readonly declarations: readonly PackageableDeclaration[];
  readonly diagnostics: readonly CheckedEffectDiagnostic[];
  readonly info: CheckedEffectInfo;
}

/** Creates an empty `CheckedEffectInfo` with optional table overrides. */
export function createCheckedEffectInfo(overrides: Partial<CheckedEffectInfo> = {}): CheckedEffectInfo {
  return {
    env: overrides.env ?? { schemas: new Map(), errors: new Set(builtinErrors.keys()), classes: new Map() },
    errorFields: overrides.errorFields ?? new Map([...builtinErrors.keys()].map((name) => [name, []])),
    services: overrides.services ?? new Map(),
    operations: overrides.operations ?? new Map(),
    functions: overrides.functions ?? new Map(),
    constants: overrides.constants ?? new Map(),
    layers: overrides.layers ?? new Map(),
    valueTypes: overrides.valueTypes ?? new WeakMap(),
    effectTypes: overrides.effectTypes ?? new WeakMap(),
    calls: overrides.calls ?? new WeakMap(),
    matches: overrides.matches ?? new WeakMap(),
    recordTargets: overrides.recordTargets ?? new WeakMap(),
    literalTargets: overrides.literalTargets ?? new WeakMap(),
    contextCalls: overrides.contextCalls ?? new WeakSet(),
  };
}

/**
 * Adapts a checker output (either `{ info }` from `checkMechanicsDeclarations`
 * or `{ check }` from `checkMechanicsProgram`) into a `CheckedEffectProgram`.
 */
export function toCheckedEffectProgram(
  input:
    | {
        readonly ok: boolean;
        readonly declarations: readonly PackageableDeclaration[];
        readonly diagnostics: readonly CheckedEffectDiagnostic[];
        readonly info: CheckedEffectInfo;
      }
    | {
        readonly ok: boolean;
        readonly declarations: readonly PackageableDeclaration[];
        readonly diagnostics: readonly CheckedEffectDiagnostic[];
        readonly check: CheckedEffectInfo;
      },
): CheckedEffectProgram {
  return {
    ok: input.ok,
    declarations: input.declarations,
    diagnostics: input.diagnostics,
    info: "info" in input ? input.info : input.check,
  };
}

// ---------------------------------------------------------------------------
// Solver-neutral IR query helpers
// ---------------------------------------------------------------------------

/**
 * The constants each constant needs while the module loads: those it names
 * directly and those named by any function it can reach (functions run when
 * called, so a constant that calls `scale` needs what `scale` reads).
 */
export function constantDependencies(
  declarations: readonly PackageableDeclaration[],
): ReadonlyMap<string, ReadonlySet<string>> {
  const constants = new Map<string, JsonValue | undefined>();
  const functions = new Map<string, JsonValue | undefined>();
  for (const declaration of declarations) {
    const payload = declaration.payload;
    if (!isRecord(payload) || typeof payload["name"] !== "string") continue;
    if (payload["kind"] === "ValueDef") constants.set(payload["name"], payload["value"]);
    if (payload["kind"] === "FunctionDef") functions.set(payload["name"], payload["body"]);
  }
  const mentioned = (node: JsonValue | undefined, names = new Set<string>()): Set<string> => {
    if (Array.isArray(node)) node.forEach((item) => mentioned(item, names));
    else if (isRecord(node)) {
      if (node["kind"] === "Var" && typeof node["name"] === "string") names.add(node["name"]);
      for (const [key, value] of Object.entries(node)) if (key !== "span" && key !== "effect") mentioned(value, names);
    }
    return names;
  };
  const result = new Map<string, ReadonlySet<string>>();
  for (const [name, value] of constants) {
    const needed = new Set<string>();
    const visitedFunctions = new Set<string>();
    const queue = [...mentioned(value)];
    while (queue.length > 0) {
      const next = queue.pop()!;
      if (constants.has(next)) needed.add(next);
      if (functions.has(next) && !visitedFunctions.has(next)) {
        visitedFunctions.add(next);
        queue.push(...mentioned(functions.get(next)));
      }
    }
    result.set(name, needed);
  }
  return result;
}

export function keywordName(node: JsonValue | undefined): string | undefined {
  if (!isRecord(node) || node["kind"] !== "Expr") return undefined;
  const source = node["source"];
  if (isRecord(source) && source["kind"] === "Symbol" && typeof source["name"] === "string" && source["name"].startsWith(":")) {
    return source["name"].slice(1);
  }
  return undefined;
}

export function recordKey(node: JsonValue | undefined): string | undefined {
  if (!isRecord(node)) return undefined;
  const keyword = keywordName(node);
  if (keyword !== undefined) return keyword;
  if (node["kind"] === "Literal" && typeof node["value"] === "string") return node["value"].replace(/^:/, "");
  return undefined;
}

export interface Pattern {
  /** The case it names, as text (`"some"`, `"admin"`, `"1"`, `"true"`). */
  readonly tag: string;
  /** For literal patterns, the literal itself. */
  readonly value?: string | number | boolean;
  readonly binding?: string;
}

export function parsePattern(pattern: JsonValue | undefined, kind?: string): Pattern | undefined {
  const parsed = parseRawPattern(pattern);
  if (!parsed) return undefined;
  const standard: Record<string, string> =
    kind === "option"
      ? { Some: "some", None: "none", "Option.Some": "some", "Option.None": "none" }
      : kind === "result"
        ? { Ok: "success", Err: "failure", "Result.Ok": "success", "Result.Err": "failure" }
        : {};
  if (standard[parsed.tag]) return { ...parsed, tag: standard[parsed.tag]! };
  return parsed;
}

function parseRawPattern(pattern: JsonValue | undefined): Pattern | undefined {
  if (!isRecord(pattern)) return undefined;
  switch (pattern["kind"]) {
    case "Var": {
      const name = String(pattern["name"]);
      if (name === "true" || name === "false") return { tag: name, value: name === "true" };
      return { tag: name, value: name };
    }
    case "Literal": {
      const value = pattern["value"];
      return typeof value === "string" || typeof value === "number" || typeof value === "boolean"
        ? { tag: String(value), value }
        : undefined;
    }
    case "Expr": {
      const keyword = keywordName(pattern);
      return keyword === undefined ? undefined : { tag: keyword, value: keyword };
    }
    case "List": {
      const items = arrayItems(pattern["items"]);
      const head = items[0];
      const binding = items[1];
      if (items.length !== 2 || !isRecord(head) || !isRecord(binding) || binding["kind"] !== "Var") return undefined;
      const tag = head["kind"] === "Var" ? String(head["name"]) : keywordName(head);
      return tag === undefined ? undefined : { tag, binding: String(binding["name"]) };
    }
    default:
      return undefined;
  }
}
