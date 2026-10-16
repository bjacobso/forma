import { isKFloat } from "./types.js";
import { Effect } from "effect";
import type { SExpr, Loc } from "../reader/index.js";
import { KernelTypeError, ArityError } from "../diagnostic/errors.js";
import type { KernelError } from "../diagnostic/errors.js";
import { Env } from "../Env.js";
import type { KValue, KFn } from "./types.js";
import { isKFn, isKKeyword, describeType } from "./types.js";
import type { EvaluatorRuntime, EvalFn } from "./eval-types.js";
import {
  getEvaluatorRuntime,
  getDispatchWrapperData,
  EVAL_DISPATCH_WRAPPER_KEY,
} from "./eval-types.js";
import type { DispatchWrapperData, EvalDispatchKFn } from "./eval-types.js";
import { applyKFn } from "./eval-core.js";

// ---------------------------------------------------------------------------
// Type class instances — runtime dispatch
// ---------------------------------------------------------------------------

/**
 * Determine the runtime type name for dispatch purposes.
 */
export function canonicalRuntimeTypeName(name: string): string {
  switch (name) {
    case "Number":
    case "Num":
      return "Float";
    case "Str":
      return "String";
    case "Bool":
      return "Boolean";
    case "Nil":
      return "Unit";
    default:
      return name;
  }
}

export function runtimeTypeName(val: KValue): string {
  if (val === null) return "Unit";
  if (Array.isArray(val)) return "List";
  if (val instanceof Map) return "Map";
  if (isKFloat(val)) return "Float";
  if (typeof val === "number") return "Int";
  if (isKKeyword(val)) return "Keyword";
  if (typeof val === "string") return "String";
  if (typeof val === "boolean") return "Boolean";
  return "Unknown";
}

/**
 * (instance (ClassName TypeName)
 *   (define methodName (fn [params] body))
 *   ...)
 *
 * Evaluates each method body, stores it in the dispatch table, and creates
 * dispatch wrapper functions bound in the environment.
 */
export function evalInstance(
  items: readonly SExpr[],
  loc: Loc,
  env: Env,
  runtime: EvaluatorRuntime,
  evalExpr: EvalFn,
): Effect.Effect<{ env: Env; result: KValue }, KernelError> {
  return Effect.gen(function* () {
    if (items.length < 3) {
      return yield* new ArityError({
        name: "instance",
        expected: "2+",
        got: items.length - 1,
        loc,
      });
    }

    // Skip optional constraints vector
    let idx = 1;
    if (items[idx]?._tag === "Vector") {
      idx++;
    }

    const headerExpr = items[idx]!;
    if (headerExpr._tag !== "List" || headerExpr.items.length < 2) {
      return yield* new KernelTypeError({
        message: "instance header must be (ClassName TypeName ...)",
        expected: "(ClassName TypeName)",
        got: headerExpr._tag,
        loc: headerExpr.loc,
      });
    }

    const classNameExpr = headerExpr.items[0]!;
    if (classNameExpr._tag !== "Sym") {
      return yield* new KernelTypeError({
        message: "instance class name must be a symbol",
        expected: "symbol",
        got: classNameExpr._tag,
        loc: classNameExpr.loc,
      });
    }
    const className = classNameExpr.name;

    // Extract the type name — for simple cases like (Functor List), it's a symbol.
    // For complex cases like (Eq (List a)), we take the head constructor.
    const typeNameExpr = headerExpr.items[1]!;
    let typeName: string;
    if (typeNameExpr._tag === "Sym") {
      typeName = canonicalRuntimeTypeName(typeNameExpr.name);
    } else if (
      typeNameExpr._tag === "List" &&
      typeNameExpr.items.length > 0 &&
      typeNameExpr.items[0]!._tag === "Sym"
    ) {
      typeName = canonicalRuntimeTypeName(typeNameExpr.items[0]!.name);
    } else {
      return yield* new KernelTypeError({
        message: "instance type must be a symbol or type application",
        expected: "type name",
        got: typeNameExpr._tag,
        loc: typeNameExpr.loc,
      });
    }

    idx++;

    let currentEnv = env;

    // Evaluate each method definition
    for (let i = idx; i < items.length; i++) {
      const m = items[i]!;
      if (m._tag !== "List" || m.items.length !== 3) {
        return yield* new KernelTypeError({
          message: "instance method must be (define name expr)",
          expected: "(define name expr)",
          got: m._tag,
          loc: m.loc,
        });
      }

      const defSym = m.items[0]!;
      if (defSym._tag !== "Sym" || defSym.name !== "define") {
        return yield* new KernelTypeError({
          message: "instance method must start with define",
          expected: "define",
          got: defSym._tag === "Sym" ? defSym.name : defSym._tag,
          loc: defSym.loc,
        });
      }

      const mNameSym = m.items[1]!;
      if (mNameSym._tag !== "Sym") {
        return yield* new KernelTypeError({
          message: "instance method name must be a symbol",
          expected: "symbol",
          got: mNameSym._tag,
          loc: mNameSym.loc,
        });
      }
      const methodName = mNameSym.name;

      // Evaluate the method body to get a KFn
      const methodVal = yield* evalExpr(m.items[2]!, currentEnv, runtime);

      if (!isKFn(methodVal)) {
        return yield* new KernelTypeError({
          message: `instance method '${methodName}' must evaluate to a function`,
          expected: "function",
          got: describeType(methodVal),
          loc: m.items[2]!.loc,
        });
      }

      // Determine dispatch arg index (default: 1 for binary like fmap, 0 for unary)
      // For most HKT methods, dispatch on the last arg that's the container type.
      // Simple heuristic: if method has 2+ params, dispatch on index 1 (second arg),
      // otherwise dispatch on index 0.
      const dispatchArgIndex = methodVal.params.length >= 2 ? 1 : 0;
      const existingData = getDispatchWrapperData(currentEnv.lookup(methodName));
      const implementations =
        existingData &&
        existingData.methodName === methodName &&
        existingData.className === className &&
        existingData.dispatchArgIndex === dispatchArgIndex
          ? new Map(existingData.implementations)
          : new Map<string, KFn>();
      implementations.set(typeName, methodVal);

      // Create/update dispatch wrapper and bind in env
      const wrapper = makeDispatchWrapper(methodName, className, dispatchArgIndex, implementations);
      currentEnv = currentEnv.bind(methodName, wrapper);
    }

    return { env: currentEnv, result: null };
  });
}

/**
 * Create a dispatch wrapper KFn for a type class method.
 * The wrapper examines the runtime type of the dispatch argument,
 * looks up the implementation in the wrapper-local registry, and calls it.
 */
export function makeDispatchWrapper(
  methodName: string,
  className: string,
  dispatchArgIndex: number,
  implementations: Map<string, KFn> = new Map(),
): KFn {
  const data: DispatchWrapperData = {
    methodName,
    className,
    dispatchArgIndex,
    implementations,
  };
  const wrapper: EvalDispatchKFn = {
    _tag: "KFn",
    params: ["__dispatch_arg"],
    body: {
      _tag: "Sym" as const,
      name: "nil",
      loc: { start: 0, end: 0, line: 0, col: 0 },
    },
    closure: Env.empty(),
    // Override apply — this is a variadic dispatch wrapper
    apply: (args: readonly KValue[], context?: unknown) =>
      Effect.gen(function* () {
        const runtime = getEvaluatorRuntime(context);
        if (!runtime) {
          return yield* new KernelTypeError({
            message: "Evaluator runtime not initialized — cannot dispatch instance method",
            expected: "active evaluator runtime",
            got: "no runtime",
            loc: { start: 0, end: 0, line: 0, col: 0 },
          });
        }

        const dispatchArg = args[data.dispatchArgIndex];
        if (dispatchArg === undefined) {
          return yield* new ArityError({
            name: methodName,
            expected: `${data.dispatchArgIndex + 1}+`,
            got: args.length,
          });
        }

        const tn = runtimeTypeName(dispatchArg);
        const impl = data.implementations.get(tn);

        if (!impl) {
          return yield* new KernelTypeError({
            message: `No instance of ${data.className} for ${tn} (method: ${methodName})`,
            expected: `${data.className} ${tn} instance`,
            got: "no instance",
            loc: { start: 0, end: 0, line: 0, col: 0 },
          });
        }

        // Call the concrete implementation
        return yield* applyKFn(impl, args, runtime);
      }),
    [EVAL_DISPATCH_WRAPPER_KEY]: data,
  };
  return wrapper;
}
