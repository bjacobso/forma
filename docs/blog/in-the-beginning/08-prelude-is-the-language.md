---
title: The Prelude Is the Language
description: Part 8 of From Lists to Languages. Shrink the compiler to a kernel of numbers, names, and calls; build quote, lambda, a generalizing let, if, and match as typed forms in a prelude; then build a small pricing language on the same kernel.
---

# The Prelude Is the Language

<p class="blog-meta">Part 08 of <a href="/blog/in-the-beginning/">From Lists to Languages</a> · Act II, Types and Extension · <time datetime="2026-11-08">November 8, 2026</time></p>

> A small kernel, many languages.

[Part 7](/blog/in-the-beginning/07-macros) ended with a macro that the
checker couldn't speak for. The user wrote `(twice (lambda (a b) a) 1)`,
and the error pointed inside `twice`'s template, at a call the user never
wrote. A macro is a rewrite that runs *before* checking, so the checker
only ever sees what the macro produced.

This post adds the other kind of extension: a **form**, which runs
*during* checking. A form gets its piece of syntax and the checker's
tools, and it decides what its parts must be, which names it binds, what
type the whole thing has, and what core it becomes. Forms live in a
**prelude**, and the compiler shrinks to a **kernel** that knows almost
nothing on its own. By the end, `lambda` is a form, `let` does something
no macro can, and a second language runs on the same kernel.

## The kernel

Part 6's elaborator had a case for each of Part 4's node types: `Num`,
`Ref`, `Quote`, `Lambda`, and `Call`. Part 4's parser had already decided
which lists were which. The kernel works on the s-expression itself and
knows three things: numbers, names, and calls.

<<< @/snippets/blog/in-the-beginning/08/kernel.ts#kernel

A list whose head names a form is handed to the form. Everything else is
a number, a name, or a call, which are elaborated as in Part 6.

The check for locals matters. Part 7's expander didn't know about scopes,
so a parameter named `square` still expanded as the macro. The kernel
does know, because it's the thing that builds frames. A local that shadows
a form's name wins:

```lisp
((lambda (if) (if 7)) (lambda (n) (* n 2)))   ; => 14
```

`kernel(frame)` is everything a form can ask for:

<<< @/snippets/blog/in-the-beginning/08/kernel.ts#form

The kernel elaborates and checks a form's parts, opens frames for the
names a form binds, and applies the call rule. `fresh` and `generalize`
are for writing typing rules. A form never sees the solver itself, and it
can't make a frame that the kernel doesn't know about.

A language is then a value, a prelude:

<<< @/snippets/blog/in-the-beginning/08/kernel.ts#prelude

Built-in functions now live in the program's outermost frame, so a
reference to `+` is a `Local` like any other. Core still has Part 6's six
node types, and Part 6's executor runs the result unchanged:

<<< @/snippets/blog/in-the-beginning/08/run.ts#run

## lambda and quote are forms

`quote` and `lambda` used to be cases in Part 4's parser. Now they're
entries in a prelude:

<<< @/snippets/blog/in-the-beginning/08/prelude.ts#quote

<<< @/snippets/blog/in-the-beginning/08/prelude.ts#lambda

The syntax rules and messages are Part 4's. The typing rule is Part 5's:
a fresh unknown for each parameter, and a function type from those to the
body's type. Notice the inner `(k) =>`: inside `within`, the form gets a
kernel for the new frame, and the body is elaborated there.

## let, and a promise from Part 5

[Part 5](/blog/in-the-beginning/05-types-before-execution) rejected this
program, even though it runs fine:

```lisp
((lambda (id) ((id id) 1)) (lambda (x) x))
```

`id` is a parameter, and a parameter gets one type. Applying `id` to
itself needs two. Part 5 said the fix was to generalize names bound by
`let`, and that `let` would come back as a prelude form.

A macro can't do it. Here's `let` as a Part 7 macro:

```lisp
(defmacro my-let
  ((((name value)) body) `((lambda (,name) ,body) ,value)))

(my-let ((id (lambda (x) x))) ((id id) 1))
```

It expands into exactly the program above, and fails the same way:

```txt
error: infinite type: 'a = ('a) -> 'b
4 | (my-let ((id (lambda (x) x))) ((id id) 1))
  |                                 ^^
```

The rewrite is right, but the typing rule is the one for `lambda`. A form
gets to bring its own rule. Here's what the rule needs. A **type scheme**
is a type plus the variables that each use may choose for itself:

<<< @/snippets/blog/in-the-beginning/08/kernel.ts#scheme

Generalizing turns a type into a scheme, and using a name turns its
scheme back into a type with fresh variables:

<<< @/snippets/blog/in-the-beginning/08/kernel.ts#generalize

The key line is `vars = free.filter(...)`. An unknown that a name in an
enclosing frame also mentions isn't the value's to give away; something
outside may still decide it. Here `z`'s type is `y`'s type, so it stays
one type, and `+` settles it:

```lisp
(lambda (y) (let ((z y)) (+ z 1)))   ; : (Num) -> Num
```

With those two tools, `let` is a form like any other:

<<< @/snippets/blog/in-the-beginning/08/prelude.ts#let

Each binding is elaborated, generalized, and then bound for the rest. The
core is the same `((lambda (id) ...) ...)` that the macro produced; only
the typing differs.

```lisp
(let ((id (lambda (x) x)))
  ((id id) 1))
; => 1
```

`id` has the scheme `('a) -> 'a`, and each mention gets its own `'a`.
`lambda` parameters still get one type each. That's the classic
Hindley–Milner arrangement: a `let` knows the value it's generalizing,
and a parameter doesn't know which argument it will get.

## twice, at the call

With a generalizing `let`, `twice` doesn't need to be a macro. It's a
function, and its type is inferred:

```lisp
(let ((twice (lambda (f x) (f (f x)))))
  twice)
; : (('a) -> 'a, 'a) -> 'a
```

That type is the rule Part 7 wanted: `twice` takes a one-argument
function and a value. Nobody wrote it down, and the checker enforces it
at the user's call:

```txt
error: expected ('a) -> 'a, got ('b, 'c) -> 'b
2 |   (twice (lambda (a b) a) 1))
  |          ^^^^^^^^^^^^^^^^
```

Most of Part 7's macros were functions waiting for this. A macro is still
the right tool for new *syntax*, which a function can't provide. `let`
itself is an example: its bindings aren't expressions.

## if, without a new core node

Core has no conditional. It doesn't need one, because it already has a
way to delay work: a function with no parameters runs nothing until it's
called. A conditional can pick one of two such functions and call it:

```lisp
((choose test (lambda () yes) (lambda () no)))
```

`choose` is an ordinary function in the prelude with the type
`(Num, 'a, 'a) -> 'a`. A form calls prelude functions through
`k.prelude`:

<<< @/snippets/blog/in-the-beginning/08/prelude.ts#call

<<< @/snippets/blog/in-the-beginning/08/prelude.ts#branch

`if` adds the typing rule: the test is a number, and both branches have
one type.

<<< @/snippets/blog/in-the-beginning/08/prelude.ts#if

`(if 1 2 3)` elaborates to plain core, the same six node types:

```txt
call : Num
  call : () -> Num
    local choose @0.8 : (Num, () -> Num, () -> Num) -> () -> Num
    lit 1 : Num
    lambda () : () -> Num
      lit 2 : Num
    lambda () : () -> Num
      lit 3 : Num
```

Only the chosen branch runs, so `(if 0 (print 1) (print 2))` prints `2`
and nothing else. The diagnostics are about `if`, at the user's source,
not about `choose` or thunks:

```txt
error: expected Num, got Data
1 | (if 1 2 'a)
  |         ^^
```

```txt
error: expected Num, got Data
1 | (if 'a 1 2)
  |     ^^
```

`k.prelude` also closes the other gap Part 7 left open. Part 7's macros
looked up a template's free names, like `*` in `scale`, wherever the
macro was used. A form looks up `choose` in the prelude, wherever it's
used, so a user's own `choose` can't change what `if` means:

```lisp
((lambda (choose) (if 1 2 3)) 5)   ; => 2
```

## match

`match` compares a number with literal cases, in order:

```lisp
(let ((size (lambda (n)
              (match n (0 'none) (1 'one) (_ 'many)))))
  (size 1))
; => one
```

<<< @/snippets/blog/in-the-beginning/08/prelude.ts#match

Its rules are its own. Every case is a number or `_` with one result, and
the last case must be `_`, so every number has an answer:

```txt
error: match needs a last (_ result) case
1 | (match 2 (0 'none) (1 'one))
  | ^^^^^^^^^^^^^^^^^^^^^^^^^^^^
```

Every result is checked against one shared type, case by case, so a
mismatch is reported at the case that's different:

```txt
error: expected Data, got Num
1 | (match 2 (0 'none) (1 2) (_ 'many))
  |                       ^
```

`match` binds its subject once, to `#match`. The reader rejects `#`, so
no program can write that name, and no user name can capture it.

The prelude doesn't have `when` yet. `(when test body)` does nothing when
the test fails, and in a language where every expression has a value and
a type, "nothing" needs a type of its own. That's part of what effects
bring, in the next post.

## The prelude's values

The rest of the standard prelude is its values:

<<< @/snippets/blog/in-the-beginning/08/prelude.ts#values

Conditions are numbers, with `0` meaning false, because Part 5's types
are `Num`, `Data`, and functions. A `Bool` would be one more tagged struct
in that schema.

## Another language on the same kernel

The kernel doesn't know `lambda`, so a prelude without it describes a
language without functions. Here is a language for prices. Its forms
check what a price means, not only its shape. A percentage has to be
between 0 and 100, and that's a Schema:

<<< @/snippets/blog/in-the-beginning/08/pricing.ts#percent

<<< @/snippets/blog/in-the-beginning/08/pricing.ts#price

<<< @/snippets/blog/in-the-beginning/08/pricing.ts#language

```lisp
(price 200
  (discount 25)
  (tax 10))
; => 165
```

Its errors are in its own terms, at the author's source:

```txt
error: a percentage is between 0 and 100
1 | (price 200 (discount 120))
  |                      ^^^
```

```txt
error: expected (discount n) or (tax n)
1 | (price 200 (coupon 5))
  |            ^^^^^^^^^^
```

```txt
error: tax only makes sense inside price
1 | (tax 8)
  | ^^^^^^^
```

Everything it doesn't define is out of the language. `(lambda (x) x)`
fails with `lambda is not defined`. So does quoting: `(price 'a (tax 1))`
fails with `quote is not defined`, pointing at the `'`.

Preludes are maps, so languages combine. With both, a function can
compute prices:

```lisp
(let ((sale (lambda (amount) (price amount (discount 25)))))
  (sale 80))
; => 60
```

A literal percentage is checked when the program compiles; a computed one,
like `(tax rate)`, is only checked to be a number. The kernel, the core,
the executor, and Part 6's compiled artifacts are the same for all three
languages. Only the prelude changed.

## What forms bought

Go back to the Lisp Curse. Part 7's macros made new words cheap, and
nothing about a word told the checker how to use it. A form is still
cheap, but it comes with a rule. The kernel enforces it, the errors use
the form's terms, and they point at the user's source. A tool can list
the words a language has by reading its prelude.

There's a limit to that last sentence. A tool can list a prelude's
forms, but each form's rule is a TypeScript function, so the only way to
find out what `price` accepts is to run it. In Forma, a form declares its
syntax and the types of its parts as data, and the rule is built from that
declaration; see [Writing a form](/writing-a-form). This series keeps
forms as functions, but Part 10 comes back to programs that tools can
read.

To try it, put Parts 2 through 7 in directories named `02` to `07`, this
post's files in `08`, install `effect` version 4, and run this with Node
24 from inside `08`:

```ts
import { Effect } from "effect";
import { pricing } from "./pricing.ts";
import { standard } from "./prelude.ts";
import { typeOf } from "./run.ts";

const id = "(let ((id (lambda (x) x))) id)";
console.log(Effect.runSync(typeOf(standard, id))); // ('a) -> 'a
const price = "(price 200 (discount 25) (tax 10))";
console.log(Effect.runSync(typeOf(pricing, price))); // Num
```

## What's next

That's the end of Act II. The language has syntax with a schema, types
checked before it runs, a compiler to a small typed core, macros for new
syntax, and forms for new rules.

One thing in it still isn't honest. `print` has the type `('a) -> 'a`,
the same as `id`. Nothing in the type says that it prints, or that it
needs an `Output` service to run. The checker knows what every
expression returns, and nothing about what it does.

**Next:** [Part 9, *Effects Are Part of the Type*](/blog/in-the-beginning/09-effects-are-part-of-the-type).
The type describes not only the result, but what a computation demands.

<p class="blog-source">The code in this post lives in
<a href="https://github.com/bjacobso/forma/tree/main/docs/snippets/blog/in-the-beginning/08"><code>docs/snippets/blog/in-the-beginning/08</code></a>
and runs in the site's test suite.</p>
