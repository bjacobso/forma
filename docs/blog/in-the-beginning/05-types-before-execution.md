---
date: 2026-11-07
title: Types Before Execution
description: Part 5 of From Lists to Languages. Represent types with Effect Schema, infer them with unification, and reject ill-typed programs before they run, with errors that point at the call site.
---

# Types Before Execution

<p class="blog-meta">Part 05 of <a href="/blog/in-the-beginning/">From Lists to Languages</a> · Act II, Types and Extension · <time datetime="2026-11-07">November 7, 2026</time></p>

> `(+ 1 "hello")` should be a type error before evaluation.

Act I gave the language form, meaning, and an environment. Every error it
reports is still found the same way: by running the program until something
goes wrong. [Part 4](/blog/in-the-beginning/04-environment-is-not-the-world)
ended on a program that shows the cost:

```txt
error: + expects numbers, got a
1 | ((lambda (x) (+ x 1)) (quote a))
  |                 ^
```

The error points inside the function, at `x`. But the function is fine. The
mistake is the argument, `(quote a)`, and finding that took running the
program up to the point where the bad value was used. In a bigger program
that point can be far away, or only reached on Tuesdays, or reached after
the program has already printed, charged, or deleted something.

This post adds a **type checker**: a second interpretation of the same tree
that runs before the evaluator. It computes what *kind* of value each
expression produces, without producing any values. A program that doesn't
check never starts.

Our language has no strings yet, so `(+ 1 "hello")` from the series outline
becomes `(+ 1 (quote hello))`. It's the same mistake: adding something that
isn't a number.

## Types are data

A type has a shape, so it gets a schema. There are four kinds of type:
numbers, quoted data, functions, and type **variables**, which stand for
types the checker hasn't worked out yet.

<<< @/snippets/blog/in-the-beginning/05/types.ts#type

As with the syntax tree in Part 2, describing types as a schema makes them
values that can leave the process. The type `(Num) -> Num` encodes as plain
JSON:

```json
{ "_tag": "TFun", "params": [{ "_tag": "TNum" }], "rest": null,
  "result": { "_tag": "TNum" } }
```

Decoding a malformed type from outside, such as one written by another
tool, fails with a path to the bad part:

```ts
Schema.decodeUnknownSync(Type)({
  _tag: "TFun",
  params: [{ _tag: "Num" }],
  rest: null,
  result: { _tag: "TNum" },
});
// throws a SchemaError: none of the four shapes match,
//   at ["params"][0]
```

That is everything Schema contributes here, and it's worth being exact
about. Schema can tell you that a value is a well-formed *type*. It can't
tell you that a program *has* that type. That's a judgment, and our checker
has to make it. A few helpers build and print types:

<<< @/snippets/blog/in-the-beginning/05/types.ts#build

<<< @/snippets/blog/in-the-beginning/05/types.ts#show

## The rules

Before any code, here is the judgment the checker makes, one rule per kind
of expression:

- A number has type `Num`.
- A quotation has type `Data`, whatever it quotes.
- A name has the type its scope gives it.
- `(lambda (x ...) body)` has type `(A ...) -> B`, where each `A` is the
  type of a parameter and `B` is the type of the body, checked in a scope
  where the parameters have those types.
- `(f arg ...)` requires `f` to be a function that accepts that many
  arguments, and each argument to have the matching parameter's type. The
  call has the function's result type.

The fourth rule hides the hard part. When the checker meets
`(lambda (x) (+ x 1))`, it doesn't know the type of `x` yet. It only learns
it from the body, where `x` is passed to `+`.

## Unknowns and unification

So each parameter starts as a fresh type variable, an unknown. As the
checker walks the body, it collects facts: "this unknown must be `Num`",
"this unknown must be a function from that to something else". The
procedure that turns those facts into answers is **unification**:

<<< @/snippets/blog/in-the-beginning/05/check.ts#solver

Three ideas carry the whole thing:

- **`fresh`** makes a new unknown.
- **`unify(want, got)`** makes two types equal. If one side is an unknown,
  it records the other side as its answer. If both are functions, it unifies
  them piece by piece. If they're different concrete types, it reports a
  mismatch.
- **`resolve`** substitutes everything learned so far into a type.

The solver is created inside the checking Effect, so every run of that
Effect starts with no unknowns.

`+` is variadic, so a function type can have a `rest` type for extra
arguments. One helper decides which parameter types a call with `n`
arguments gets:

<<< @/snippets/blog/in-the-beginning/05/check.ts#arity

## A scope of types

The checker resolves names exactly as the evaluator does, through lexical
scopes. A type scope maps each name to a way of getting its type:

<<< @/snippets/blog/in-the-beginning/05/check.ts#scope

`print` returns whatever it's given, so its type is `('a) -> 'a`, which is
**polymorphic**: it works for any `'a`. Each mention of `print` gets fresh
unknowns, so `(print 1)` and `(print (quote hi))` can appear in the same
program without forcing `'a` to be both `Num` and `Data`.

## The checker

With unification and scopes, the checker follows the rules:

<<< @/snippets/blog/in-the-beginning/05/check.ts#infer

`inferCall` covers one more case the rules glossed over. When the function
being called is still an unknown, such as a parameter `f`, calling it is
itself a fact: `f` must be a function from these argument types to some
result.

Here's what it infers, without running anything:

```txt
(lambda (x) (+ x 1))          : (Num) -> Num
(lambda (x) x)                : ('a) -> 'a
(lambda (f x) (f (f x)))      : (('a) -> 'a, 'a) -> 'a
(lambda (f g x) (f (g x)))    : (('a) -> 'b, ('c) -> 'a, 'c) -> 'b
+                             : (Num...) -> Num
(print (quote hi))            : Data
((lambda (f) (f 1 2)) +)      : Num
```

The third line is worth reading slowly. Nobody wrote a type. The checker
saw `f` applied to `x`, then applied again to the result. It concluded that
`f` must return the same type it takes, and that `x` must have that type.

## Errors before running

Checking fails with typed errors, like evaluation does, and they carry
spans:

<<< @/snippets/blog/in-the-beginning/05/errors.ts#errors

The pipeline gains one step between parsing and evaluation:

<<< @/snippets/blog/in-the-beginning/05/run.ts#run

Now Part 4's program fails before it runs, and the error points at the
argument:

```txt
error: expected Num, got Data
1 | ((lambda (x) (+ x 1)) (quote a))
  |                       ^^^^^^^^^
```

The checker inferred `(Num) -> Num` for the function from its body, then
compared that with the argument at the call. The blame moved from where the
bad value was *used* to where it was *introduced*.

The series' opening example is caught the same way:

```txt
error: expected Num, got Data
1 | (+ 1 (quote hello))
  |      ^^^^^^^^^^^^^
```

And because checking happens first, a program that fails to check has no
effects at all. `(+ (print 1) (quote x))` used to print `1` and then fail.
Now it fails before printing anything.

Calling a number, passing the wrong number of arguments, and using an
unbound name are all caught the same way, before running:

```txt
error: expected a function, got Num
1 | (5 1)
  |  ^

error: expected 1 argument, got 2
1 | (print 1 2)
  | ^^^^^^^^^^^
```

To try it, put Parts 2, 3, and 4 in directories named `02`, `03`, and `04`,
this post's files in `05`, install `effect` version 4, and run this with
Node 24 from inside `05`:

```ts
import { Effect } from "effect";
import { typeOf } from "./run.ts";

console.log(Effect.runSync(typeOf("(lambda (x) (+ x 1))")));
// (Num) -> Num
```

## Types that would have to contain themselves

One program has no sensible type at all:

```txt
error: infinite type: 'a = ('a) -> 'b
1 | (lambda (x) (x x))
  |              ^
```

`x` is applied to itself, so its type `'a` would have to be a function
taking `'a`, which would have to be a function taking a function taking
`'a`, and so on forever. The `occurs` check in `bind` catches that before
it can loop.

## What the checker gives up

A type checker that rejects every program that would fail must also reject
some programs that wouldn't. This one runs fine under Part 4's evaluator
and returns `1`:

```lisp
((lambda (id) ((id id) 1)) (lambda (x) x))
```

The checker rejects it with the same infinite-type error. Inside the
lambda, `id` is a parameter, and parameters get one type each. Applying
`id` to itself needs two different types at once. The same limit rejects
`(lambda (f) (+ (f 1) (f (quote a))))`: `f` can't take both a `Num` and a
`Data`.

`print` doesn't have this problem because it's a global whose type is
written down as polymorphic. Parameters only get the single type the
checker infers. The classic fix is to generalize names bound by `let`, which
returns as a prelude form in Part 8.

The checker also doesn't make every runtime error impossible. `(/ 1 0)`
has type `Num`, and it still fails at runtime with `division by zero`.
Types describe what kind of value an expression produces, not which value.

## Two passes over one tree

Look at the pipeline again: parse, then `Effect.tap(check)`, then
`evaluate`. The checker computes a type for every expression, and `tap`
throws them all away. Then the evaluator walks the same tree again,
resolving every name again, and still checks for unbound names, calls to
non-functions, wrong argument counts, and non-numbers passed to `+`.

For a checked program, those four runtime checks should never fire. That's
the claim a soundness argument is supposed to establish, and so far we've
only tested it, not argued it. Still, the evaluator doesn't know any of
this. It's still interpreting the *surface* syntax, the language as
written, and it re-derives everything the checker already proved.

The fix is to make checking produce something: a smaller, typed **core**
language that the evaluator can trust. That's the step that turns the
interpreter into a compiler.

**Next:** [Part 6, *The Interpreter Becomes a Compiler*](/blog/in-the-beginning/06-interpreter-becomes-compiler).
Syntax is what you write. Core is what it means.

<p class="blog-source">The code in this post lives in
<a href="https://github.com/bjacobso/forma/tree/main/docs/snippets/blog/in-the-beginning/05"><code>docs/snippets/blog/in-the-beginning/05</code></a>
and runs in the site's test suite.</p>
