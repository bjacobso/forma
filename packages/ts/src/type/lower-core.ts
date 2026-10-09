import { parseTypeExpr } from "./type-parser.js";
import { mapKey } from "../evaluator/types.js";
/**
 * Core lower dispatch and module-level state.
 *
 * This module contains the main `lower` dispatch plus shared utilities
 * (spanOf, freshInternalBinding, module-level state). The handler modules
 * (lower-binding, lower-control, lower-typedef, lower-destructure) import
 * only the utilities from this file, and this file imports the handlers.
 * Node/TS handles this circular dependency correctly because the handler
 * modules only use the utilities at call-time (not at import-time).
 */
import type { SExpr } from "../reader/index.js";
import type { CoreExpr, DSLFormChild, Span } from "./core-expr.js";
import {
  CTypeDef,
  CLit,
  CVar,
  CApp,
  CDef,
  CRecord,
  CDSLForm,
  LInt,
  LString,
  LBool,
  LKeyword,
  LSymbol,
  LNil,
  mkRecordField,
} from "./core-expr.js";
import { InferenceError } from "./errors.js";
import type { DSLTypeProvider } from "./dsl-provider.js";
import { sourceTraceOf } from "../evaluator/source-trace.js";

// ---------------------------------------------------------------------------
// Callback type
// ---------------------------------------------------------------------------

export type LowerFn = (expr: SExpr) => CoreExpr;

// ---------------------------------------------------------------------------
// Module-level state
// ---------------------------------------------------------------------------

let _dslProvider: DSLTypeProvider | undefined;
let _internalBindingCounter = 0;

export const getDslProvider = () => _dslProvider;
export const setDslProvider = (p: DSLTypeProvider | undefined) => {
  _dslProvider = p;
};
export const getInternalBindingCounter = () => _internalBindingCounter;
export const setInternalBindingCounter = (n: number) => {
  _internalBindingCounter = n;
};
export const resetBindingCounter = () => {
  _internalBindingCounter = 0;
};

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

export function spanOf(expr: SExpr): Span {
  const trace = sourceTraceOf(expr);
  return {
    start: trace.loc.start,
    end: trace.loc.end,
    ...(trace.macroOrigins ? { macroOrigins: trace.macroOrigins } : {}),
  };
}

export function freshInternalBinding(prefix: string): string {
  // `@` is not a legal user symbol character, so these temporaries stay internal.
  return `@${prefix}_${_internalBindingCounter++}`;
}

// ---------------------------------------------------------------------------
// Handler imports (circular but safe — only used at call-time)
// ---------------------------------------------------------------------------

import { lowerFn, lowerLet, lowerDef, lowerDo, lowerEffectDo } from "./lower-binding.js";
import {
  lowerIf,
  lowerWhen,
  lowerUnless,
  lowerMatch,
  lowerGet,
  lowerAscribe,
  lowerEffectFail,
  lowerEffectCatch,
} from "./lower-control.js";
import {
  lowerTypeDef,
  lowerDefineSchema,
  lowerDefineError,
  isDefineSchemaProjection,
  lowerDefineService,
  lowerDefineTypeclass,
  lowerInstance,
} from "./lower-typedef.js";

// ---------------------------------------------------------------------------
// Main dispatch
// ---------------------------------------------------------------------------

export function lower(expr: SExpr): CoreExpr {
  switch (expr._tag) {
    case "Num":
      return CLit(spanOf(expr), LInt(expr.value));
    case "Str":
      return CLit(spanOf(expr), LString(expr.value));
    case "Bool":
      return CLit(spanOf(expr), LBool(expr.value));

    case "Sym":
      if (expr.name === "nil") return CLit(spanOf(expr), LNil);
      if (expr.name.startsWith(":")) return CLit(spanOf(expr), LKeyword(expr.name));
      return CVar(spanOf(expr), expr.name);

    case "Vector":
      // Vectors: lower each item, wrap as an App of `vector`
      return CApp(spanOf(expr), CVar(spanOf(expr), "__vector"), expr.items.map(lower));

    case "Map":
      return lowerMap(expr);

    case "Set":
      throw new InferenceError({
        message: "Set literals are not supported as runtime values, only in type expressions",
      });

    case "List":
      return lowerList(expr);

    case "Error":
      throw new InferenceError({
        message: `Parse error: ${expr.message}`,
      });
  }
}

function lowerMap(expr: SExpr & { _tag: "Map" }): CoreExpr {
  const span = spanOf(expr);
  const fields = expr.pairs.map(([k, v]) => {
    const label = k._tag === "Sym" ? k.name : k._tag === "Str" ? mapKey(k.value)! : `:${String(k)}`;
    return mkRecordField(spanOf(k), label, lower(v));
  });
  return CRecord(span, fields);
}

function lowerList(expr: SExpr & { _tag: "List" }): CoreExpr {
  const span = spanOf(expr);
  const items = expr.items;

  if (items.length === 0) {
    return CLit(span, LNil);
  }

  const head = items[0]!;

  if (head._tag === "Sym") {
    switch (head.name) {
      case "quote": {
        if (items.length !== 2) throw new InferenceError({message:"quote expects one datum"});
        const quoted = (e:SExpr):CoreExpr => e._tag === "Sym" && e.name !== "nil" && !e.name.startsWith(":") ? CLit(spanOf(e),LSymbol(e.name)) : ["List","Vector","Map"].includes(e._tag) ? CLit(spanOf(e),{_tag:"LQuoted",value:e}) : lower(e);
        return quoted(items[1]!);
      }
      case "fn":
        return lowerFn(lower, span, items);
      case "let":
        return lowerLet(lower, span, items);
      case "def":
        throw new InferenceError({
          message: "Legacy public binding form 'def' is no longer supported; use 'define'",
        });
      case "defn":
        throw new InferenceError({
          message:
            "Legacy public function binding form 'defn' is no longer supported; use 'define' with 'fn'",
        });
      case "define":
        return lowerDef(lower, span, items);
      case "__operation":
        return lowerDefineOperation(lower, span, items);
      case "module":
        return lowerModule(span, items);
      case "if":
        return lowerIf(lower, span, items);
      case "when":
        return lowerWhen(lower, span, items);
      case "unless":
        return lowerUnless(lower, span, items);
      case "do":
        return lowerDo(lower, span, items);
      case "do!":
        return lowerEffectDo(lower, span, items);
      case "fail":
        return lowerEffectFail(lower, span, items);
      case "catch":
        return lowerEffectCatch(lower, span, items);
      case "get":
      case "__map-get":
        return lowerGet(lower, span, items);
      case ":":
        return lowerAscribe(lower, span, items);
      case "deftype":
        throw new InferenceError({
          message: "Legacy public type form 'deftype' is no longer supported; use 'type'",
        });
      case "data":
        throw new InferenceError({
          message: "Legacy public ADT form 'data' is no longer supported; use 'type'",
        });
      case "__record-type":
        if (items[1]?._tag !== "Sym" || !items[2]) throw new InferenceError({message: "Named record type requires a name and fields"});
        return CTypeDef(span, items[1].name, parseTypeExpr(items[2]), undefined, undefined, items[3]?._tag === "Sym" && items[3].name === "error" ? "error" : "class");
      case "__type-alias":
      case "__sum-type":
        return lowerTypeDef(span, items);
      case "__schema":
        if (isDefineSchemaProjection(items)) return lowerDefineSchema(span, items);
        break;
      case "__error":
        return lowerDefineError(span, items);
      case "__service":
        return lowerDefineService(span, items);
      case "match":
        return lowerMatch(lower, span, items);
      case "defclass":
        throw new InferenceError({
          message:
            "Legacy public typeclass form 'defclass' is no longer supported; use 'typeclass'",
        });
      case "__typeclass":
        return lowerDefineTypeclass(span, items);
      case "instance":
        return lowerInstance(lower, span, items);
      case "def-effect":
        throw new InferenceError({
          message: "Legacy algebraic effect form 'def-effect' is no longer supported.",
        });
      case "define-effect":
        throw new InferenceError({
          message:
            "Legacy algebraic effect form 'define-effect' is no longer supported; use __service and __operation.",
        });
      case "def-macro":
        throw new InferenceError({
          message:
            "Legacy public macro form 'def-macro' is no longer supported; use '__macro'",
        });
      case "__macro":
        throw new InferenceError({
          message:
            "__macro is compile-time only and cannot be lowered as a runtime expression",
        });
      case "perform":
        throw new InferenceError({
          message:
            "Legacy algebraic effect form 'perform' is no longer supported; use service method calls inside __operation.",
        });
      case "handle":
        throw new InferenceError({
          message:
            "Legacy algebraic effect form 'handle' is no longer supported; provide mechanics services at the runtime boundary.",
        });
      case "::":
        throw new InferenceError({
          message: "Legacy public signature form '::' is no longer supported; use ':'",
        });
    }

    // Check if this is a DSL form (e.g., entity-type, action, query)
    if (_dslProvider?.isKnownForm(head.name)) {
      return lowerDSLForm(span, head.name, expr);
    }
  }

  // General application: (f arg1 arg2 ...)
  return CApp(span, lower(head), items.slice(1).map(lower));
}

function lowerDefineOperation(lower: LowerFn, span: Span, items: readonly SExpr[]): CoreExpr {
  if (items.length < 4 || items[1]?._tag !== "Sym" || items[2]?._tag !== "Vector") {
    throw new InferenceError({
      message: "__operation expects a name, parameter vector, and body.",
    });
  }

  const fnForm: SExpr = {
    _tag: "List",
    loc: items[0]!.loc,
    items: [{ _tag: "Sym", name: "fn", loc: items[0]!.loc }, items[2]!, ...items.slice(3)],
  };

  return CDef(span, items[1].name, lower(fnForm));
}

function lowerModule(span: Span, items: readonly SExpr[]): CoreExpr {
  if (items.length !== 2 || items[1]?._tag !== "Sym") {
    throw new InferenceError({
      message: "module expects a module name.",
    });
  }

  return CLit(span, LNil);
}

/**
 * Lower a DSL form into a CDSLForm node.
 *
 * Delegates to the DSLTypeProvider to extract sub-expressions that need
 * type checking, and lowers those sub-expressions into CoreExpr children.
 * The rest of the form (pattern/quoted slots) is not lowered.
 */
function lowerDSLForm(span: Span, name: string, expr: SExpr): CoreExpr {
  if (!_dslProvider) {
    throw new InferenceError({ message: `No DSL provider for form: ${name}` });
  }

  // Ask the provider which sub-expressions should be type-checked
  const typedSlots = _dslProvider.extractTypedSlots(name, expr);

  // Lower each typed slot's expression
  const children: DSLFormChild[] = typedSlots.map((slot) => ({
    slotName: slot.slotName,
    expr: lower(slot.expr),
    expectedType: slot.expectedType,
  }));

  return { ...CDSLForm(span, name, children), rawExpr: expr };
}
