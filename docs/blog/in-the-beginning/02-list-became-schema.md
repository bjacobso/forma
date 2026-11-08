---
title: Giving the List a Schema
description: Part 2 of From Lists to Languages. Give s-expressions a recursive Effect Schema, add source spans, and turn parsing into a Schema transformation that reports structured diagnostics.
---

# Giving the List a Schema

<p class="blog-meta">Part 02 of <a href="/blog/in-the-beginning/">From Lists to Languages</a> · Act I, Foundations · <time datetime="2026-11-08">November 8, 2026</time></p>

> A program is data with a shape.

[Part 1](/blog/in-the-beginning/01-the-list) ended with two trees that
didn't match. The interpreter worked on s-expressions: plain numbers,
symbols, and arrays. The schema at the end described something else, an
`add` node with named fields. This post closes that gap. The s-expression
gets a schema, the schema gets a second schema for what programs *mean*,
and parsing becomes a transformation from one to the other.

Along the way, errors stop being exceptions with vague messages. They
become data that points at the source text you wrote.

## Where did that come from?

Give Part 1's reader a program with a missing parenthesis:

```lisp
(+ 1 (* 2 3)
```

It says `unexpected end of input`. True, but unhelpful: the problem is the
first `(`, which is never closed, and the error can't say so because a
Part 1 tree has nowhere to keep a location. The `1` in that program is just
the number `1`.

So every node now carries a **span**, the start and end offsets of the text
it was read from. A bare number can't carry a span, so each kind of node
becomes a tagged struct:

<<< @/snippets/blog/in-the-beginning/02/sexp.ts#sexp

This is the same three-part language as Part 1: numbers, symbols, and lists
of s-expressions. Now it's written as a schema, so the shape can be checked
on data from anywhere, not only on data our reader made. `List` refers to
`Sexp`, which includes `List`, so the reference goes through
`Schema.suspend`. As in Part 1, the explicit `Schema.Codec<Sexp>` return
type is what lets TypeScript follow the recursion.

The number `1` in `(+ 1 x)` now reads as:

```json
{ "_tag": "Num", "value": 1, "span": { "start": 3, "end": 4 } }
```

## Reading with diagnostics

When reading fails, the reader returns a diagnostic instead of throwing. A
diagnostic has a shape too, so it gets a schema:

<<< @/snippets/blog/in-the-beginning/02/read.ts#diagnostic

The reader is Part 1's reader with spans attached. It returns an
`Effect<Sexp, Diagnostic>`: either a tree, or a diagnostic saying what went
wrong and where.

<<< @/snippets/blog/in-the-beginning/02/read.ts#read

When the token stream runs out inside a list, the reader blames the `(` that
opened it, not the end of the file. A small renderer turns a diagnostic into
the familiar compiler display:

<<< @/snippets/blog/in-the-beginning/02/read.ts#render

```txt
error: this ( is never closed
1 | (+ 1 (* 2 3)
  | ^
```

## Two shapes: syntax and meaning

Every program is an s-expression, but not every s-expression is a program.
These all read without complaint:

```lisp
()            ; an empty list
(2 3)         ; a number where the operator should be
(quote x y)   ; quote with two arguments
```

Part 1 found these problems while it was evaluating, if at all.
`(quote x y)` didn't fail; it quietly returned `x`.

So there's a second tree: the **abstract syntax**, which only has room for
programs that mean something. A symbol on its own is a reference to a
name. A list headed by `quote` is a quotation of exactly one datum. Any
other list headed by a symbol is a call.

<<< @/snippets/blog/in-the-beginning/02/expr.ts#expr

Some details are deliberate. `Num` is shared because a number means itself.
`Quote` holds an `Sexp`, not an `Expr`: quoting a program turns it back into
data, so it doesn't need to mean anything. And a call's operator is a `Ref`
for now. Calling the result of an expression has to wait for functions, in
Part 4.

There's no `Expr` for `()`, `(2 3)`, or `(quote x y)`. If a value has this
type, its shape is meaningful by construction.

## Parsing is decoding

Turning syntax into meaning is a function from `Sexp` to `Expr` that can
fail. Effect Schema already has a name for that: a **transformation**. The
decode direction does the checking:

<<< @/snippets/blog/in-the-beginning/02/expr.ts#decode

Each failure is a `SchemaIssue`, the same kind of value Schema produces when
a field has the wrong type. Its annotations hold a message and the span of
the node to blame. For a bad operator that's the operator; for a bad
`quote` it's the whole form.

A transformation also runs backwards. Encoding turns an `Expr` back into an
`Sexp`, in about fifteen lines:

<<< @/snippets/blog/in-the-beginning/02/expr.ts#encode

`Schema.decodeTo` joins the two schemas with the transformation. Parsing is
then read, then decode:

<<< @/snippets/blog/in-the-beginning/02/expr.ts#parse

`ExprFromSexp` is one schema with two layers. Decoding first checks that
the input has the `Sexp` shape, then runs `toExpr`. When `toExpr` fails,
`diagnose` finds the issue it raised. The issue's annotations are exactly a
`Diagnostic`, so the `Diagnostic` schema reads them back out.

Now the programs Part 1 struggled with fail before anything runs, and the
diagnostics point at the cause:

```txt
error: quote takes exactly one argument
1 | (+ 1 (quote x y))
  |      ^^^^^^^^^^^

error: 2 is not an operator
1 | (+ 1 (2 3))
  |       ^

error: () is not an expression
1 | (+ 1 ())
  |      ^^
```

Spans are offsets into the whole source, so a program that spans several
lines works without extra effort:

```txt
error: quote takes exactly one argument
2 |    (quote a b))
  |    ^^^^^^^^^^^
```

## Diagnostics are data

The caret display is one rendering of a diagnostic, for humans in a
terminal. Underneath, a diagnostic is a value with a schema:

```json
{ "message": "quote takes exactly one argument",
  "span": { "start": 5, "end": 16 } }
```

An editor can underline that range. A test can compare it. A program can
read it without scraping text from an error message, and in Part 11 that
program will be a coding agent.

## Two kinds of wrong

The reader isn't the only way to get an `Sexp`. Another tool might send a
tree as JSON, and `ExprFromSexp` accepts that too:

```ts
const json = {
  _tag: "List",
  items: [{ _tag: "Num", value: "1", span: { start: 1, end: 2 } }],
  span: { start: 0, end: 3 },
};
Schema.decodeUnknownEffect(ExprFromSexp)(json);
// fails with SchemaError:
// Expected number
//   at ["items"][0]["value"]
```

The same schema reports two kinds of failure in two ways. When the **shape**
is wrong, as with this string where a number belongs, Schema reports a path
into the data. When the shape is right but the **meaning** is wrong, our
transformation reports a span in the source. One describes the data
structure; the other describes the program.

## The way back

Those fifteen lines pay off at once. Decode messy source,
encode it again, and print the result:

```ts
const expr = Effect.runSync(parse("(+   1\n  (quote   (a b)))"));
show(Schema.encodeSync(ExprFromSexp)(expr));
// (+ 1 (quote (a b)))
```

That's a crude formatter, almost for free. Encoding is how one shared
representation will feed several tools at once in Part 10.

## A smaller evaluator

With shapes settled by parsing, the evaluator shrinks. It no longer asks
whether a list is empty, whether the head is a symbol, or how many
arguments `quote` got. The type of its input already answers all three.

<<< @/snippets/blog/in-the-beginning/02/evaluate.ts#evaluate

```lisp
(+ 1 2)           ; => 3
(+ 1 (+ 2 3))     ; => 6
(quote (+ 1 2))   ; => (+ 1 2)
```

To try it, save the four snippet files (`sexp.ts`, `read.ts`, `expr.ts`, and
`evaluate.ts`), install `effect` version 4, and run this with Node 24:

```ts
import { Effect } from "effect";
import { display, evaluate } from "./evaluate.ts";
import { parse } from "./expr.ts";

const expr = Effect.runSync(parse("(+ 1 (+ 2 3))"));
console.log(display(evaluate(expr))); // 6
```

## What Schema did, and what it didn't

Some failures are left, and they're the instructive ones.
`(+ 1 (quote x))` parses fine: it's a call to `+` with two arguments.
Evaluating it still throws `+ expects numbers, got x`. So does `x`, with
`x is not defined`. Both errors are exceptions, and neither knows its span.

That's the boundary. Schema checked that the program has a meaningful
**shape**: every node is one we know how to evaluate, and every failure
points at the source. It didn't check that `+` receives numbers. That's a
question about what values flow where, and answering it before running the
program takes a type checker. Schema describes representations; the
language still has to establish its own typing rules. Part 5 builds that
checker.

First, the evaluator should stop throwing. Errors became data in the parser,
and the runtime deserves the same treatment.

**Next:** [Part 3, *Errors Are Not Exceptions*](/blog/in-the-beginning/03-errors-are-not-exceptions).
A language runtime should know how it can fail.

<p class="blog-source">The code in this post lives in
<a href="https://github.com/bjacobso/forma/tree/main/docs/snippets/blog/in-the-beginning/02"><code>docs/snippets/blog/in-the-beginning/02</code></a>
and runs in the site's test suite.</p>
