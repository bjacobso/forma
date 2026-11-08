import { Effect, Schema, SchemaGetter, SchemaIssue } from "effect";
import { Diagnostic, read } from "../02/read.ts";
import { Num, Sexp, Span } from "../02/sexp.ts";

// Part 2's abstract syntax, with two changes: a Lambda node, and a
// Call whose operator can be any expression.

// #region expr
export const Ref = Schema.TaggedStruct("Ref", {
  name: Schema.String,
  span: Span,
});
export const Quote = Schema.TaggedStruct("Quote", {
  datum: Sexp,
  span: Span,
});

export interface Lambda {
  readonly _tag: "Lambda";
  readonly params: ReadonlyArray<typeof Ref.Type>;
  readonly body: Expr;
  readonly span: Span;
}
export interface Call {
  readonly _tag: "Call";
  readonly fn: Expr;
  readonly args: ReadonlyArray<Expr>;
  readonly span: Span;
}
export type Expr =
  | typeof Num.Type
  | typeof Ref.Type
  | typeof Quote.Type
  | Lambda
  | Call;

const LazyExpr = Schema.suspend((): Schema.Codec<Expr> => Expr);
export const Lambda = Schema.TaggedStruct("Lambda", {
  params: Schema.Array(Ref),
  body: LazyExpr,
  span: Span,
});
export const Call = Schema.TaggedStruct("Call", {
  fn: LazyExpr,
  args: Schema.Array(LazyExpr),
  span: Span,
});
export const Expr = Schema.Union([Num, Ref, Quote, Lambda, Call]);
// #endregion expr

const invalid = (message: string, { span }: Sexp) =>
  Effect.fail(new SchemaIssue.InvalidValue({ message, span }));

type Decoded = Effect.Effect<Expr, SchemaIssue.Issue>;
type List = Extract<Sexp, { _tag: "List" }>;

// #region lambda
// (lambda (x y) body): a parameter list of distinct symbols, and
// exactly one body.
const toLambda = (x: List): Decoded =>
  Effect.gen(function* () {
    const [, params, body, ...extra] = x.items;
    if (params?._tag !== "List" || !body || extra.length > 0) {
      const message = "lambda takes a parameter list and one body";
      return yield* invalid(message, x);
    }
    const names: Array<typeof Ref.Type> = [];
    for (const param of params.items) {
      if (param._tag !== "Sym") {
        const message = "a parameter must be a symbol";
        return yield* invalid(message, param);
      }
      if (names.some((name) => name.name === param.name)) {
        const message = `${param.name} is already a parameter`;
        return yield* invalid(message, param);
      }
      names.push({ ...param, _tag: "Ref" });
    }
    const { span } = x;
    const expr = yield* toExpr(body);
    return { _tag: "Lambda", params: names, body: expr, span };
  });
// #endregion lambda

const toExpr = (x: Sexp): Decoded =>
  Effect.gen(function* () {
    if (x._tag === "Num") return x;
    if (x._tag === "Sym") return { ...x, _tag: "Ref" } as const;

    const [head, ...rest] = x.items;
    if (!head) return yield* invalid("() is not an expression", x);
    if (head._tag === "Sym" && head.name === "quote") {
      const [datum, ...extra] = rest;
      if (!datum || extra.length > 0) {
        const message = "quote takes exactly one argument";
        return yield* invalid(message, x);
      }
      return { _tag: "Quote", datum, span: x.span } as const;
    }
    if (head._tag === "Sym" && head.name === "lambda") {
      return yield* toLambda(x);
    }
    // Any other list is a call, and its head is any expression.
    const fn = yield* toExpr(head);
    const args = yield* Effect.forEach(rest, toExpr);
    return { _tag: "Call", fn, args, span: x.span } as const;
  });

export const toSexp = (e: Expr): Sexp => {
  const sym = (name: string, span: Span) =>
    ({ _tag: "Sym", name, span }) as const;
  switch (e._tag) {
    case "Num":
      return e;
    case "Ref":
      return { ...e, _tag: "Sym" };
    case "Quote":
      return {
        _tag: "List",
        items: [sym("quote", e.span), e.datum],
        span: e.span,
      };
    case "Lambda": {
      const params = e.params.map(toSexp);
      const list = { _tag: "List", items: params, span: e.span } as const;
      const items = [sym("lambda", e.span), list, toSexp(e.body)];
      return { _tag: "List", items, span: e.span };
    }
    case "Call": {
      const items = [toSexp(e.fn), ...e.args.map(toSexp)];
      return { _tag: "List", items, span: e.span };
    }
  }
};

export const ExprFromSexp = Sexp.pipe(
  Schema.decodeTo(Expr, {
    decode: SchemaGetter.transformEffect(toExpr),
    encode: SchemaGetter.transform(toSexp),
  }),
);

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
