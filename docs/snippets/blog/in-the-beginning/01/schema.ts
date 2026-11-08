import { Effect, Schema } from "effect";

// #region expr
// The same tree, described as a schema: a number, or an `add` node
// whose children are trees of the same shape.
export type Expr = number | Add;
export interface Add {
  readonly op: "add";
  readonly left: Expr;
  readonly right: Expr;
}

export const Expr = Schema.Union([
  Schema.Number,
  Schema.Struct({
    op: Schema.Literal("add"),
    left: Schema.suspend((): Schema.Codec<Expr> => Expr),
    right: Schema.suspend((): Schema.Codec<Expr> => Expr),
  }),
]);
// #endregion expr

// #region run
// Evaluation is an Effect: a description of a computation that can
// be run, composed, and inspected for how it fails.
const evaluate = (expr: Expr): Effect.Effect<number> =>
  typeof expr === "number"
    ? Effect.succeed(expr)
    : Effect.gen(function* () {
        const left = yield* evaluate(expr.left);
        const right = yield* evaluate(expr.right);
        return left + right;
      });

// Decode untrusted input into an Expr, then evaluate it. The type
// says what it returns and how it fails:
// Effect<number, Schema.SchemaError>.
export const run = (input: unknown) =>
  Schema.decodeUnknownEffect(Expr)(input).pipe(
    Effect.flatMap(evaluate),
  );
// #endregion run
