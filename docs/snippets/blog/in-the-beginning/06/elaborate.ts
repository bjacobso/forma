import { Effect } from "effect";
import type { Expr } from "../04/expr.ts";
import { globalTypes, makeSolver, paramsFor } from "../05/check.ts";
import {
  ArityError,
  type CheckError,
  Mismatch,
  UnboundName,
} from "../05/errors.ts";
import { data, fun, num, showType, type Type } from "../05/types.ts";
import type { Core } from "./core.ts";

type Elab = Effect.Effect<Core, CheckError>;
type Of<T extends Expr["_tag"]> = Extract<Expr, { _tag: T }>;

// #region frame
// At compile time, a frame is parameter names and their types.
// Where a name sits (how many frames out, which slot) is all the
// running program will need.
interface Frame {
  readonly params: ReadonlyArray<string>;
  readonly types: ReadonlyArray<Type>;
  readonly parent: Frame | undefined;
}
// #endregion frame

// #region elaborate
// Part 5's checker, with one change: every case returns a core node
// instead of only a type.
export const elaborate = (expr: Expr): Elab =>
  Effect.gen(function* () {
    const { fresh, resolve, unify } = makeSolver();

    const go = (e: Expr, frame: Frame | undefined): Elab =>
      Effect.gen(function* () {
        const { span } = e;
        switch (e._tag) {
          case "Num":
            return { _tag: "Lit", value: e.value, type: num, span };
          case "Quote":
            const { datum } = e;
            return { _tag: "Datum", datum, type: data, span };
          case "Ref":
            return yield* ref(e, frame);
          case "Lambda": {
            const params = e.params.map((param) => param.name);
            const types = params.map(() => fresh());
            const inner = { params, types, parent: frame };
            const body = yield* go(e.body, inner);
            const type = fun(types, body.type);
            return { _tag: "Lambda", params, body, type, span };
          }
          case "Call":
            return yield* call(e, frame);
        }
      });

    // Resolve a name now, once, instead of every time it runs.
    const ref = (e: Of<"Ref">, frame: Frame | undefined): Elab =>
      Effect.gen(function* () {
        const { name, span } = e;
        let depth = 0;
        for (let f = frame; f; f = f.parent, depth++) {
          const slot = f.params.indexOf(name);
          if (slot === -1) continue;
          const type = f.types[slot]!;
          return { _tag: "Local", name, depth, slot, type, span };
        }
        const typeOf = globalTypes.names.get(name);
        if (typeOf) {
          const type = typeOf(fresh);
          return { _tag: "Global", name, type, span };
        }
        return yield* new UnboundName({ symbol: name, span });
      });

    const call = (e: Of<"Call">, frame: Frame | undefined): Elab =>
      Effect.gen(function* () {
        const { span } = e;
        const fn = yield* go(e.fn, frame);
        const args: Core[] = [];
        for (const arg of e.args) args.push(yield* go(arg, frame));
        const f = resolve(fn.type);
        if (f._tag === "TVar") {
          const type = fresh();
          const types = args.map((arg) => arg.type);
          yield* unify(f, fun(types, type), fn.span);
          return { _tag: "Call", fn, args, type, span };
        }
        if (f._tag !== "TFun") {
          const expected = "a function";
          const got = showType(f);
          const { span } = fn;
          return yield* new Mismatch({ expected, got, span });
        }
        const params = paramsFor(f, args.length);
        if (!params) {
          const expected = f.params.length;
          const got = args.length;
          return yield* new ArityError({ expected, got, span });
        }
        for (const [i, arg] of args.entries()) {
          yield* unify(params[i]!, arg.type, arg.span);
        }
        return { _tag: "Call", fn, args, type: f.result, span };
      });

    // Inference is over: write the final answers into every node.
    const settle = (c: Core): Core => {
      const type = resolve(c.type);
      switch (c._tag) {
        case "Lambda":
          return { ...c, type, body: settle(c.body) };
        case "Call": {
          const args = c.args.map(settle);
          return { ...c, type, fn: settle(c.fn), args };
        }
        default:
          return { ...c, type };
      }
    };

    return settle(yield* go(expr, undefined));
  });
// #endregion elaborate
