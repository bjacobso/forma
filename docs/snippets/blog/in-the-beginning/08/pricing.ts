import { Effect, Schema } from "effect";
import type { Sexp } from "../02/sexp.ts";
import { num } from "../05/types.ts";
import type { Core } from "../06/core.ts";
import {
  type Elab,
  fail,
  type Form,
  type Kernel,
  type Prelude,
} from "./kernel.ts";
import { arithmetic, call, standard } from "./prelude.ts";

// #region percent
// A percentage is a number between 0 and 100. A literal one is
// checked when the program compiles.
const Percent = Schema.Number.check(
  Schema.isBetween(
    { minimum: 0, maximum: 100 },
    { message: "a percentage is between 0 and 100" },
  ),
);

const percentage = (x: Sexp, k: Kernel): Elab =>
  Effect.gen(function* () {
    if (x._tag === "Num") {
      const decoded = Schema.decodeUnknownEffect(Percent)(x.value);
      yield* Effect.mapError(decoded, (e) => ({
        message: e.message,
        span: x.span,
      }));
    }
    return yield* k.check(x, num);
  });
// #endregion percent

// #region price
// (price base (discount n) (tax n) ...): adjust a base amount by
// percentages, in order.
const adjustments = new Map([
  ["discount", "-"],
  ["tax", "+"],
]);

const price: Form = ({ items, span }, k) =>
  Effect.gen(function* () {
    const [, base, ...steps] = items;
    if (!base) {
      return yield* fail("price needs a base amount", span);
    }
    let total = yield* k.check(base, num);
    for (const step of steps) {
      const [head, amount, ...extra] =
        step._tag === "List" ? step.items : [];
      const op = head?._tag === "Sym" && adjustments.get(head.name);
      if (!op || !amount || extra.length > 0) {
        const message = "expected (discount n) or (tax n)";
        return yield* fail(message, step.span);
      }
      // total * (100 - n) / 100 for a discount, + for a tax.
      const { span } = step;
      const n = yield* percentage(amount, k);
      const hundred: Core = {
        _tag: "Lit",
        value: 100,
        type: num,
        span,
      };
      const factor = yield* call(k, op, [hundred, n], span);
      const scaled = yield* call(k, "*", [total, factor], span);
      total = yield* call(k, "/", [scaled, hundred], span);
    }
    return total;
  });

// discount and tax mean something only inside a price.
const inside =
  (name: string): Form =>
  ({ span }) =>
    fail(`${name} only makes sense inside price`, span);
// #endregion price

// #region language
// A language for prices: three forms and four functions, on the
// same kernel. No lambda, no let, no if.
export const pricing: Prelude = {
  forms: new Map([
    ["price", price],
    ["discount", inside("discount")],
    ["tax", inside("tax")],
  ]),
  values: arithmetic,
};

// Or both languages at once.
export const combined: Prelude = {
  forms: new Map([...standard.forms, ...pricing.forms]),
  values: new Map([...standard.values, ...pricing.values]),
};
// #endregion language
