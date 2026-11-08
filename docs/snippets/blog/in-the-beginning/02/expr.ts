import { Effect, Schema, SchemaGetter, SchemaIssue } from "effect";
import { Diagnostic, read } from "./read.ts";
import { Num, Sexp, show, Span } from "./sexp.ts";

// #region expr
// The abstract syntax: what a list means, not how it was written.
export const Ref = Schema.TaggedStruct("Ref", {
  name: Schema.String,
  span: Span,
});
export const Quote = Schema.TaggedStruct("Quote", {
  datum: Sexp,
  span: Span,
});

export interface Call {
  readonly _tag: "Call";
  readonly op: typeof Ref.Type;
  readonly args: ReadonlyArray<Expr>;
  readonly span: Span;
}
export type Expr =
  | typeof Num.Type
  | typeof Ref.Type
  | typeof Quote.Type
  | Call;

const LazyExpr = Schema.suspend((): Schema.Codec<Expr> => Expr);
export const Call = Schema.TaggedStruct("Call", {
  op: Ref,
  args: Schema.Array(LazyExpr),
  span: Span,
});
export const Expr = Schema.Union([Num, Ref, Quote, Call]);
// #endregion expr

// #region decode
// Sexp -> Expr. A list that means nothing fails with an issue that
// carries a diagnostic: a message and the offending node's span.
const invalid = (message: string, { span }: Sexp) =>
  Effect.fail(new SchemaIssue.InvalidValue({ message, span }));

type Decoded = Effect.Effect<Expr, SchemaIssue.Issue>;

const toExpr = (x: Sexp): Decoded =>
  Effect.gen(function* () {
    if (x._tag === "Num") return x;
    if (x._tag === "Sym") return { ...x, _tag: "Ref" } as const;

    const [head, ...rest] = x.items;
    if (!head) return yield* invalid("() is not an expression", x);
    if (head._tag !== "Sym") {
      const message = `${show(head)} is not an operator`;
      return yield* invalid(message, head);
    }
    if (head.name === "quote") {
      const [datum, ...extra] = rest;
      if (!datum || extra.length > 0) {
        const message = "quote takes exactly one argument";
        return yield* invalid(message, x);
      }
      return { _tag: "Quote", datum, span: x.span } as const;
    }
    const op = { ...head, _tag: "Ref" } as const;
    const args = yield* Effect.forEach(rest, toExpr);
    return { _tag: "Call", op, args, span: x.span } as const;
  });
// #endregion decode

// #region encode
// Expr -> Sexp: the way back, so the same schema can also print.
const toSexp = (e: Expr): Sexp => {
  switch (e._tag) {
    case "Num":
      return e;
    case "Ref":
      return { ...e, _tag: "Sym" };
    case "Quote": {
      const { datum, span } = e;
      const quote = { _tag: "Sym", name: "quote", span } as const;
      return { _tag: "List", items: [quote, datum], span };
    }
    case "Call": {
      const items = [toSexp(e.op), ...e.args.map(toSexp)];
      return { _tag: "List", items, span: e.span };
    }
  }
};
// #endregion encode

// #region parse
export const ExprFromSexp = Sexp.pipe(
  Schema.decodeTo(Expr, {
    decode: SchemaGetter.transformEffect(toExpr),
    encode: SchemaGetter.transform(toSexp),
  }),
);

// Find the issue our transformation raised; its annotations are a
// Diagnostic, so the Diagnostic schema reads them back.
const diagnose = (issue: SchemaIssue.Issue): Diagnostic =>
  "issue" in issue ? diagnose(issue.issue)
  : Schema.decodeUnknownSync(Diagnostic)(
      issue._tag === "InvalidValue" ? issue.annotations : undefined,
    );

export const parse = (source: string) =>
  read(source).pipe(
    Effect.flatMap(Schema.decodeEffect(ExprFromSexp)),
    Effect.mapError((error) =>
      Schema.isSchemaError(error) ? diagnose(error.issue) : error,
    ),
  );
// #endregion parse
