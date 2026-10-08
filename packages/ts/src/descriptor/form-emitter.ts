import { Effect } from "effect";
import { Env } from "../Env.js";
import { defaultBuiltins } from "../builtins/index.js";
import { KernelTypeError } from "../diagnostic/errors.js";
import { evaluateCompileTimeExprs } from "../evaluator/eval.js";
import { expandKernelExprsSync } from "../evaluator/frontend.js";
import { kValueToSExpr } from "../evaluator/quasiquote.js";
import {
  isKSExpr,
  isKSymbol,
  isKKeyword,
  type BuiltinFn,
  type KValue,
} from "../evaluator/types.js";
import { schemaExpressionTs } from "../mechanics/effect-schema.js";
import { isRecord } from "../mechanics/types.js";
import { mechanicsPackageableDeclarations } from "../mechanics/artifact.js";
import { camelIdentifier, typeName } from "../mechanics/naming.js";
import type { SExpr } from "../reader/types.js";
import { datum } from "../surface/datum.js";
import {
  head,
  list,
  name,
  sym,
  normalizeEffectTypes,
} from "../surface/effect.js";
import type { FormDescriptor } from "./FormDescriptor.js";
import type { JsonValue } from "../artifact/artifact.js";

/** A small expression AST shared by concrete IR emission and builder derivation. */
export function renderTypeScript(e: SExpr): string {
  switch (e._tag) {
    case "Str":
    case "Num":
    case "Bool":
      return JSON.stringify(e.value);
    case "Sym": {
      if (e.name === "nil") return "undefined";
      if (e.name.startsWith(":")) return JSON.stringify(e.name.slice(1));
      if (!/^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*$/.test(e.name))
        throw new Error(`Invalid target reference ${e.name}`);
      return e.name;
    }
    case "Vector":
      return `[${e.items.map(renderTypeScript).join(", ")}]`;
    case "Map":
      return `{ ${e.pairs.map(([k, v]) => `${JSON.stringify(name(k)?.replace(/^:/, "") ?? (k._tag === "Str" ? k.value : ""))}: ${renderTypeScript(v)}`).join(", ")} }`;
    case "List": {
      const args = e.items.slice(1);
      const render = (at: number) => renderTypeScript(args[at]!);
      switch (head(e)) {
        case "ts/code": {
          if (args.length !== 1 || args[0]?._tag !== "Str")
            throw new Error("ts/code expects one compiler-produced expression");
          return args[0].value;
        }
        case "ts/method": {
          const method = args[1];
          if (
            method?._tag !== "Str" ||
            !/^[A-Za-z_$][\w$]*$/.test(method.value)
          )
            throw new Error("Invalid method name");
          return `${render(0)}.${method.value}(${args.slice(2).map(renderTypeScript).join(", ")})`;
        }
        case "ts/spread":
          return `...${render(0)}`;
        case "ts/arrow": {
          if (args[0]?._tag !== "Vector" || args.length !== 2)
            throw new Error("ts/arrow expects [parameters] and a body");
          return `(${args[0].items.map(renderTypeScript).join(", ")}) => (${render(1)})`;
        }
        default: {
          if (!e.items[0]) throw new Error("Cannot emit an empty call");
          return `${renderTypeScript(e.items[0])}(${args.map(renderTypeScript).join(", ")})`;
        }
      }
    }
    default:
      throw new Error(`Unsupported TypeScript template node ${e._tag}`);
  }
}

const loc = { start: 0, end: 0, line: 1, col: 1 };
export const targetCode = (code: string): KValue => ({
  _tag: "KSExpr",
  expr: {
    _tag: "List",
    loc,
    items: [
      { _tag: "Sym", name: "ts/code", loc },
      { _tag: "Str", value: code, loc },
    ],
  },
});
const reference = (value: KValue): KValue => {
  const identifier = String(value);
  if (!/^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*$/.test(identifier))
    throw new Error(`Invalid target reference ${identifier}`);
  return { _tag: "KSExpr", expr: { _tag: "Sym", name: identifier, loc } };
};

/** Wire payloads become keyword-keyed records for ordinary Lisp access. */
export function emissionDatum(value: JsonValue): KValue {
  if (Array.isArray(value)) return value.map(emissionDatum);
  if (value !== null && typeof value === "object")
    return new Map(
      Object.entries(value).map(([k, v]) => [`:${k}`, emissionDatum(v)]),
    );
  return value;
}

export function emissionTypeSyntax(value: KValue): SExpr {
  if (typeof value === "string") return { _tag: "Sym", name: value, loc };
  if (Array.isArray(value))
    return { _tag: "List", items: value.map(emissionTypeSyntax), loc };
  if (value instanceof Map)
    return {
      _tag: "Map",
      pairs: [...value].map(
        ([k, v]) =>
          [{ _tag: "Sym", name: k, loc }, emissionTypeSyntax(v)] as const,
      ),
      loc,
    };
  return kValueToSExpr(value);
}

export function emissionSchema(value: KValue): JsonValue {
  const type = normalizeEffectTypes(emissionTypeSyntax(value), true);
  const projected = mechanicsPackageableDeclarations(
    [list(type, [sym(type, "__schema"), sym(type, "TemplateSchema"), type])],
    "emit",
    true,
  );
  if (!projected.ok)
    throw new Error(projected.diagnostics.map((d) => d.message).join("; "));
  const payload = projected.declarations[0]?.payload;
  if (!isRecord(payload) || payload["schema"] === undefined)
    throw new Error("Cannot project schema for template");
  return payload["schema"];
}

/** Evaluate an authored :emit function over an IR value, including nested forms. */
export function emitFormExpression(
  descriptor: FormDescriptor,
  ir: KValue,
  descriptors: readonly FormDescriptor[],
  schemaAnnotations: ReadonlyMap<
    string,
    Readonly<Record<string, JsonValue>>
  > = new Map(),
): SExpr {
  const spec = descriptor.surface;
  const hook = spec?.options.get(":emit");
  if (!spec || !hook)
    throw new Error(`Form ${descriptor.name} has no :emit hook`);
  const nested = (value: KValue): SExpr => {
    if (!(value instanceof Map)) throw new Error("Expected a child IR record");
    const kind = value.get(":kind");
    const child = descriptors.find(
      (d) =>
        d.surface?.ir?._tag === "Map" &&
        d.surface.ir.pairs.some(
          ([k, v]) =>
            name(k) === ":kind" && v._tag === "Str" && v.value === kind,
        ),
    );
    if (!child) throw new Error(`No emitter for child kind ${String(kind)}`);
    return emitFormExpression(child, value, descriptors, schemaAnnotations);
  };
  const schema = (value: KValue): KValue => {
    if (isKSExpr(value)) return value;
    if (value === null) return reference("undefined");
    const expression = schemaExpressionTs(
      emissionSchema(value),
      { schemaConst: typeName },
      true,
    );
    const annotations = schemaAnnotations.get(String(value));
    return targetCode(
      annotations
        ? `${expression}.annotate(${JSON.stringify(annotations)})`
        : expression,
    );
  };
  const pure =
    (fn: (args: readonly KValue[]) => KValue): BuiltinFn =>
    (args) =>
      Effect.try({
        try: () => fn(args),
        catch: (error) =>
          new KernelTypeError({
            message: String(error),
            expected: "valid target template",
            got: "invalid template",
          }),
      });
  const builtins = {
    ...defaultBuiltins,
    "ts/ref": pure((args) => reference(args[0]!)),
    "ts/schema": pure((args) => schema(args[0]!)),
    "ts/schemas": pure((args) => {
      const value = args[0];
      if (value && isKSExpr(value)) return value;
      const schemas = Array.isArray(value)
        ? value.map(schema).map((v) => renderTypeScript(kValueToSExpr(v)))
        : [];
      return targetCode(`[${schemas.join(", ")}]`);
    }),
    "ts/children": pure((args) => {
      const value = args[0]!;
      if (isKSExpr(value))
        return [
          targetCode(
            `...${renderTypeScript(value.expr)}.map(child => child.value)`,
          ),
        ];
      if (!Array.isArray(value))
        throw new Error("ts/children expects child records");
      return value.map((v) =>
        isKSExpr(v) ? v : { _tag: "KSExpr", expr: nested(v) },
      );
    }),
    "ts/declaration": pure((args) =>
      isKSExpr(args[0]!) ? args[0]! : reference(typeName(String(args[0]))),
    ),
    "ts/operation": pure((args) => reference(camelIdentifier(String(args[0])))),
    "ts/chain": pure((args) => {
      const base = String(args[0]);
      reference(base);
      if (!Array.isArray(args[1]))
        throw new Error("ts/chain expects target expressions");
      let code = base;
      for (const item of args[1]) {
        const expression = renderTypeScript(kValueToSExpr(item));
        if (!expression.startsWith(`${base}.`))
          throw new Error(`Chain emitter must extend ${base}`);
        code += expression.slice(base.length);
      }
      return targetCode(code);
    }),
  };
  const expression = list(hook, [hook, sym(hook, "__ir")]);
  const env = Env.empty().bind("__ir", ir);
  const expanded = expandKernelExprsSync([...spec.helpers, expression], {
    env,
    builtins,
  }).expanded;
  const result = Effect.runSync(
    evaluateCompileTimeExprs(expanded, { env, builtins, stepLimit: 100_000 }),
  );
  return kValueToSExpr(result.value);
}

export const emitFormTypeScript = (
  descriptor: FormDescriptor,
  ir: JsonValue,
  descriptors: readonly FormDescriptor[],
  schemaAnnotations?: ReadonlyMap<string, Readonly<Record<string, JsonValue>>>,
): string =>
  renderTypeScript(
    emitFormExpression(
      descriptor,
      emissionDatum(ir),
      descriptors,
      schemaAnnotations,
    ),
  );

/** Symbolic projection for the deliberately small builder subset. */
export function projectBuilderIR(
  descriptor: FormDescriptor,
  bindings: ReadonlyMap<string, KValue>,
): KValue {
  const body = descriptor.surface?.body;
  if (!body) throw new Error(`Form ${descriptor.name} has no projection`);
  const project = (e: SExpr): KValue => {
    if (e._tag === "Sym" && bindings.has(e.name)) return bindings.get(e.name)!;
    if (e._tag === "Map")
      return new Map(e.pairs.map(([k, v]) => [name(k)!, project(v)]));
    if (
      e._tag === "Str" ||
      e._tag === "Num" ||
      e._tag === "Bool" ||
      e._tag === "Sym"
    )
      return datum(e);
    throw new Error(
      `Builder projection for ${descriptor.name} only supports records, literal values, and hole references`,
    );
  };
  return project(body);
}

export function builderIRCode(
  value: KValue,
  children: ReadonlySet<string> = new Set(),
): string {
  if (isKSExpr(value)) {
    const code = renderTypeScript(value.expr);
    return children.has(code) ? `${code}.map(child => child.ir)` : code;
  }
  if (isKSymbol(value)) return JSON.stringify(value.name);
  if (isKKeyword(value)) return JSON.stringify(value.name.slice(1));
  if (value instanceof Map)
    return `{ ${[...value].map(([k, v]) => `${JSON.stringify(k.replace(/^:/, ""))}: ${builderIRCode(v, children)}`).join(", ")} } as const`;
  return renderTypeScript(kValueToSExpr(value));
}
