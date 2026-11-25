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
