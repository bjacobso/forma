---
title: Start with a List
description: Part 1 of From Lists to Languages. Build the smallest Lisp imaginable, numbers, symbols, lists, and an evaluator, and see why code-as-data matters more than parentheses.
---

# Start with a List

<p class="blog-meta">Part 01 of <a href="/blog/in-the-beginning/">From Lists to Languages</a> · Act I, Foundations · <time datetime="2026-11-08">November 8, 2026</time></p>

```lisp
(+ 1 2) ; => 3
```

By the end of this post that line runs, in about fifty lines of TypeScript
with no dependencies. No manifesto first. Let's build the thing.

## Three kinds of thing

A program in our Lisp is made of exactly three kinds of thing: numbers,
symbols, and lists of programs.

<<< @/snippets/blog/in-the-beginning/01/lisp.ts#data

That type is the whole syntax of the language. It's also the whole data
model. A symbol is a small object rather than a bare string so that the tree
stays plain data: you can print it as JSON, store it, send it over a wire, and
read it back.

## Reading: text becomes data

The reader turns text into that data. Pad the parentheses with spaces, split
on whitespace, and build nested arrays.

<<< @/snippets/blog/in-the-beginning/01/lisp.ts#read

Here is what it makes of a slightly bigger program:

```lisp
(+ 1 (+ 2 3))
```

```json
[{"sym":"+"},1,[{"sym":"+"},2,3]]
```

That array *is* the program. It isn't a private structure the parser builds
and the compiler throws away. It's an ordinary value that any code can hold.

Notice what the reader doesn't know: it has never heard of `+`. It has no
grammar rule for addition, no precedence table, no keywords. Every program
has the same syntax, a list whose first element is usually an operator, so
the reader never changes when the language grows.

A printer goes the other way:

<<< @/snippets/blog/in-the-beginning/01/lisp.ts#show

## Evaluating: data becomes a value

The evaluator has three rules. A number means itself. A list means: evaluate
the arguments, then apply the operator named at the head. And there's one
special form, `quote`, which returns its argument as data instead of
evaluating it.

<<< @/snippets/blog/in-the-beginning/01/lisp.ts#evaluate

That's the language:

```lisp
(+ 1 2)          ; => 3
(+ 1 (+ 2 3))    ; => 6
(* 2 (+ 3 4))    ; => 14
(quote (+ 1 2))  ; => (+ 1 2)
```

To try it, save the snippets as `lisp.ts` and run it with Node 24, which runs
TypeScript directly:

```ts
import { evaluate, read, show } from "./lisp.ts";

console.log(show(evaluate(read("(+ 1 (+ 2 3))")))); // 6
```

The last example is the important one. `(quote (+ 1 2))` doesn't produce
`3`. It produces the program `(+ 1 2)`, as a list, as a value. Code went in
and data came out, and they were the same thing.

## Why code-as-data matters more than parentheses

People notice Lisp's parentheses first. They are the least interesting part.
What matters is that a program is a tree made of the language's own values,
so other programs can work on it with ordinary functions. Here are three
such functions, each a few lines long.

**Inspect.** Which operators does a program use?

<<< @/snippets/blog/in-the-beginning/01/programs.ts#inspect

`operators(read("(+ 1 (* 2 3))"))` returns `+` and `*`. No parser API, no
visitor pattern: just recursion over arrays.

**Generate.** Build a program without writing any text:

<<< @/snippets/blog/in-the-beginning/01/programs.ts#generate

`sumTo(5)` prints as `(+ 1 2 3 4 5)`, and evaluating `sumTo(100)` gives
`5050`. The program was computed, not typed.

**Transform.** Teach the language a new word, `square`, by rewriting the
tree before the evaluator sees it:

<<< @/snippets/blog/in-the-beginning/01/programs.ts#transform

```lisp
(+ 1 (square (+ 2 3)))
; expands to
(+ 1 (* (+ 2 3) (+ 2 3)))
; => 26
```

We just extended the language without touching the evaluator. That rewrite
is a macro in miniature, and it's the whole reason Lisp programmers put up
with the parentheses: when syntax is data, a new language construct is just
a function from trees to trees.

## The first cracks

Look closely and the cracks are already there.

`square` copies its argument, so `(+ 2 3)` now runs twice. Here that's
harmless. Once expressions can read files or charge credit cards, it's a
bug, and once they can bind names, a careless rewrite captures the wrong
variable. Part 7 is about doing this properly.

Only `expand` knows what `square` means. The evaluator doesn't: run the
program without expanding first and you get `square is not defined`.
Nothing checks its arguments: `(square 1 2)` quietly becomes `(* 1 1)`.
Nothing documents it, and when it's misused the error points at the
expanded code, not the code you wrote. Multiply that by every team's private macros
and you have the **Lisp Curse**: inventing abstractions is easy, but other
people and tools can't understand them.

And every failure is a thrown exception. `(+ 1 (quote x))` throws
`+ expects numbers, got x` while the program runs, and the type of
`evaluate`, `(x: Sexp) => Sexp`, says nothing about how it can fail. Part 3
fixes that.

## The revelation

Step back and look at what we built. A Lisp program is a tree. A tree has a
shape. And a shape is exactly what
[Effect Schema](https://effect.website/docs/schema/introduction/) describes.

Here is the same idea, a number or an addition of two smaller expressions,
written as a recursive schema instead of a TypeScript type:

<<< @/snippets/blog/in-the-beginning/01/schema.ts#expr

It describes the tree of this Lisp program:

```lisp
(+ 1 (+ 2 3))
```

Now the evaluator can be an Effect, and the input can be anything at all:
JSON from a file, a message from another process, a tree some other program
generated. Schema checks the shape at the boundary; Effect runs what's
inside.

<<< @/snippets/blog/in-the-beginning/01/schema.ts#run

```ts
const tree = {
  op: "add",
  left: 1,
  right: { op: "add", left: 2, right: 3 },
};
Effect.runSync(run(tree)); // 6

run({ op: "add", left: 1, right: "2" })
// fails with SchemaError:
// Expected number | { readonly "op": "add", ... }
//   at ["right"]
```

Two things changed. Malformed programs are rejected *before* evaluation,
with a path to the part that's wrong. And the type of `run` now says what can
go wrong: `Effect<number, SchemaError>`. Failure stopped being a surprise
and became part of the contract.

> A Lisp program is a tree. Schema can describe that tree. Effect can
> evaluate it, validate its environment, and report its failures.

The `Expr` schema above is deliberately not our s-expression. It names its
fields (`op`, `left`, `right`), and it only knows about addition. Part 2
closes that gap: the schema will describe the s-expressions themselves,
the reader will produce a checked syntax tree, and diagnostics will point
at source text instead of JSON paths.

## Where this is going

The interesting part isn't evaluating `(+ 1 2)`. It comes later, when the tree
can describe *new language constructs*, `square` and much more, and typed
elaboration turns those constructs into programs that are checked before
they run. Lisp gives the freedom to invent the construct. Schema gives it a
shape that tools can inspect. Effect gives it consequences that are explicit
in the type.

That's where the combination becomes more than the sum of its parts.

**Next:** [Part 2, *Giving the List a Schema*](/blog/in-the-beginning/02-list-became-schema).
A program is data with a shape.

<p class="blog-source">The code in this post lives in
<a href="https://github.com/bjacobso/forma/tree/main/docs/snippets/blog/in-the-beginning/01"><code>docs/snippets/blog/in-the-beginning/01</code></a>
and runs in the site's test suite.</p>
