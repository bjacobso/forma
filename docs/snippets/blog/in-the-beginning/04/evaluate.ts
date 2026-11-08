import { Effect } from "effect";
import { show } from "../02/sexp.ts";
import type { Output } from "./capabilities.ts";
import {
  type EvalError,
  NotCallable,
  UnboundName,
  WrongArity,
} from "./errors.ts";
import { type Expr, toSexp } from "./expr.ts";
import {
  type Arg,
  type Closure,
  extend,
  lookup,
  type Scope,
  type Value,
} from "./scope.ts";

// #region rule
// Which scope does a function body run in? The one where the
// function was written, or the one where it was called?
export type ScopeRule = (closure: Closure, caller: Scope) => Scope;

export const lexical: ScopeRule = (closure) => closure.scope;
export const dynamic: ScopeRule = (_closure, caller) => caller;
// #endregion rule

type Eval = Effect.Effect<Value, EvalError, Output>;

// #region evaluate
// Names come in as an argument. Capabilities come in through R.
export const evaluateWith = (rule: ScopeRule) => {
  const evaluate = (e: Expr, scope: Scope): Eval =>
    Effect.gen(function* () {
      switch (e._tag) {
        case "Num":
          return e.value;
        case "Quote":
          return e.datum;
        case "Lambda": {
          const params = e.params.map((param) => param.name);
          return { _tag: "Closure", params, body: e.body, scope };
        }
        case "Ref": {
          const value = lookup(scope, e.name);
          if (value !== undefined) return value;
          const { name: symbol, span } = e;
          return yield* new UnboundName({ symbol, span });
        }
        case "Call": {
          const fn = yield* evaluate(e.fn, scope);
          const args: Arg[] = [];
          for (const arg of e.args) {
            const value = yield* evaluate(arg, scope);
            args.push({ value, span: arg.span });
          }
          if (typeof fn === "object" && fn._tag === "Primitive") {
            return yield* fn.apply(args, e.span);
          }
          if (typeof fn === "object" && fn._tag === "Closure") {
            const expected = fn.params.length;
            if (args.length !== expected) {
              const { span } = e;
              const got = args.length;
              return yield* new WrongArity({ expected, got, span });
            }
            const bindings = fn.params.map(
              (param, i) => [param, args[i]!.value] as const,
            );
            const body = extend(rule(fn, scope), bindings);
            return yield* evaluate(fn.body, body);
          }
          const symbol = show(toSexp(e.fn));
          const { span } = e.fn;
          return yield* new NotCallable({ symbol, span });
        }
      }
    });
  return evaluate;
};

export const evaluate = evaluateWith(lexical);
// #endregion evaluate
