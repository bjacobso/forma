---
title: Macros Are Programs About Programs
description: Part 7 of In the Beginning Was the Schema. Add quasiquotation and pattern-based macros written in the language, expand them before the compiler, make them hygienic by renaming, and see why homoiconicity alone isn't enough.
---

# Macros Are Programs About Programs

<p class="blog-meta">Part 07 of <a href="/blog/in-the-beginning/">In the Beginning Was the Schema</a> · Act II, Logos · <time datetime="2026-11-08">November 8, 2026</time></p>

> The compiler can be extended in its own language.

[Part 6](/blog/in-the-beginning/06-interpreter-becomes-compiler) ended with
`let`. It doesn't need a new core node, because it's already expressible:

```lisp
(let ((x 1)) (+ x x))
; means
((lambda (x) (+ x x)) 1)
```

So `let` is a *rewrite*: a function from trees to trees that runs before the
compiler. [Part 1](/blog/in-the-beginning/01-the-list) wrote one of those,
`expand`, which turned `(square e)` into `(* e e)`. It worked, and it left
three problems:

- It was TypeScript. Adding a word to the language meant editing the
  compiler.
- `(square (+ 2 3))` became `(* (+ 2 3) (+ 2 3))`, so the argument ran twice.
- Nothing checked the call. `(square 1 2)` quietly became `(* 1 1)`.

This post lets programs define their own rewrites, in the language, as
**macros**. It fixes all three problems, adds a fourth one that every macro
system has to face, fixes most of that, and ends on what macros can't fix.

## Templates

A macro builds code, and the natural way to build code in a Lisp is to
write down what it should look like, with holes. That's **quasiquotation**.
`quote` returns its argument as data, unchanged. `quasiquote` does the
same, except where you ask for a hole: `unquote` inserts a value, and
`unquote-splicing` inserts the items of a list.

Those names are long, so Lisp readers have shorthand for them:

<<< @/snippets/blog/in-the-beginning/07/read.ts#shorthand

The reader is Part 2's, with one new case. It also reads every form in the
source, not just one, because a program can now start with macro
definitions:

<<< @/snippets/blog/in-the-beginning/07/read.ts#prefix

So `` `(* ,e ,e) `` reads as `(quasiquote (* (unquote e) (unquote e)))`,
which is ordinary list structure. The shorthand is pure syntax; the tree is
what matters.

## Defining a macro

A macro has a name and one or more **clauses**. A clause is a pattern for
the call's arguments and a template for what the call becomes. Like
everything else in this series, a macro is data with a schema:

<<< @/snippets/blog/in-the-beginning/07/macro.ts#macro

Here is `square`, done properly:

```lisp
(defmacro square
  ((e) `((lambda (x) (* x x)) ,e)))
```

The pattern `(e)` matches a call with exactly one argument and calls it
`e`. The template binds the argument's value to `x` once and multiplies
`x` by itself, so the argument runs once however it's used.

`defmacro` forms are checked when they're read, so a malformed definition
is reported where it's written:

<<< @/snippets/blog/in-the-beginning/07/macro.ts#define

A program is now some macro definitions followed by one expression:

<<< @/snippets/blog/in-the-beginning/07/macro.ts#program

## Matching and building

Matching a pattern against a call is a short recursive function. A symbol
in the pattern binds whatever is in that position. A list matches a list of
the same length, item by item, and `&rest name` collects all the remaining
items:

<<< @/snippets/blog/in-the-beginning/07/expand.ts#match

Running a template is the other half. Outside a quasiquote, a symbol is a
pattern variable. Inside one, the template is copied, with holes filled
from the bindings:

<<< @/snippets/blog/in-the-beginning/07/expand.ts#template

Ignore `mark` for now; it's what the hygiene section is about.

## Expansion

The expander walks the program looking for lists whose head names a macro.
For each one, it tries the clauses in order, builds the expansion from the
first that matches, and expands the result again:

<<< @/snippets/blog/in-the-beginning/07/expand.ts#expand

Two things are deliberately left alone. Quoted data stays data, so
`'(square x)` evaluates to the list `(square x)`. And a `lambda`'s
parameter list isn't a call, so `(lambda (square) square)` doesn't try to
expand `(square)`.

Expansion happens before everything else. By the time Part 4's parser sees
the program, no macro calls are left, so the parser, the elaborator, and
the runtime from Part 6 don't change at all:

<<< @/snippets/blog/in-the-beginning/07/run.ts#run

## Part 1's problems, fixed

`square` is now defined in the program, not in the compiler. Its argument
runs once:

```lisp
(defmacro square
  ((e) `((lambda (x) (* x x)) ,e)))

(square (print 3))
; prints 3 once, => 9
```

And a call that doesn't fit the pattern is rejected at the call, before
anything is expanded:

```txt
error: no pattern of square matches this call
4 | (square 1 2)
  | ^^^^^^^^^^^^
```

Type errors in the arguments still point at the argument, because the
argument's syntax, spans included, is copied into the expansion as it is:

```txt
error: expected Num, got Data
4 | (square (quote a))
  |         ^^^^^^^^^
```

## Programs that write programs

A macro can expand into another call to itself. With several clauses tried
in order, that's a loop that runs at compile time. Here's `let*`, which
binds names one after another:

```lisp
(defmacro let*
  ((() body) body)
  ((((name value) &rest more) body)
   `((lambda (,name) (let* ,more ,body)) ,value)))

(let* ((x 2) (y (* x 10))) (+ x y))
```

The first clause stops when no bindings are left. The second peels off one
binding and leaves the rest to another `let*`. The program expands to:

```lisp
((lambda (x) ((lambda (y) (+ x y)) (* x 10))) 2)   ; => 22
```

`,@` splices, which is what a threading macro needs. `->` passes a value
through a series of calls, each time as the first argument:

```lisp
(defmacro ->
  ((x) x)
  ((x (f &rest args) &rest steps)
   `(-> (,f ,x ,@args) ,@steps)))

(-> 5 (+ 1) (* 2))
; expands to (* (+ 5 1) 2), => 12
```

Because macros are programs, they can also loop forever. A macro that
expands into itself without making progress is stopped after 1,000 nested
expansions:

```txt
error: loop expands forever
2 |   ((x) `(loop ,x)))
  |         ^^^^^^^^^
```

## Capture

Here's a macro that multiplies its body by a factor:

```lisp
(defmacro scale
  ((k body) `((lambda (factor) (* factor ,body)) ,k)))
```

It looks fine, and `(scale 2 3)` is `6`. Now use it where the user has a
variable of their own named `factor`:

```lisp
((lambda (factor) (scale 2 factor)) 5)
```

The user means `2 × 5`, which is `10`. A naive expander, one that copies
the template as written, produces:

```lisp
((lambda (factor) ((lambda (factor) (* factor factor)) 2)) 5)
; => 4
```

The user's `factor` was pasted inside the macro's `lambda`, and the macro's
binding **captured** it. Nothing failed, no error was reported, and the
answer is wrong. This is the classic hazard of macros that treat code as
plain lists, and it's why homoiconicity alone isn't enough. Code is data,
but it isn't *just* data: a symbol means something because of where it's
bound.

## Hygiene by renaming

A **hygienic** expander keeps the macro's names and the user's names apart.
Ours does it in two steps.

First, every symbol a template copies gets a **mark** that's unique to that
expansion. That's the `mark` function in `expand`, which turns `factor`
into `factor#1`. Symbols that came from the user, through pattern
variables, aren't marked. (That's why the reader now rejects `#` in
programs: the expander has reserved it.)

Second, after expansion, a renaming pass decides what each mark means:

<<< @/snippets/blog/in-the-beginning/07/expand.ts#rename

A marked symbol that a marked `lambda` parameter binds keeps its unique
name. Every other mark is dropped, so `lambda#1` and `*#1` go back to being
`lambda` and `*`. The same program now expands to:

```lisp
((lambda (factor) ((lambda (factor#1) (* factor#1 factor)) 2)) 5)
; => 10
```

The macro's `factor` and the user's `factor` are now different names, and
the answer is right.

## The half we didn't do

That's half of hygiene. The other half concerns the names a template uses
but doesn't bind, such as `*` in `scale`. Those should mean what they meant
where the macro was *defined*. Ours drops their marks, so they mean
whatever they mean where the macro is *used*:

```lisp
((lambda (*) (scale 2 3)) +)
; expands to ((lambda (*) ((lambda (factor#1) (* factor#1 3)) 2)) +)
; => 5, not 6: the macro's * is now the user's +
```

The expander also doesn't know about scopes: a parameter named `square`
can be used as a value, but `(square 4)` inside its function still expands
as the macro. Fixing both means tracking, for every identifier, which
scopes it came from; Racket's "sets of scopes" expander is the well-known
design. It's real machinery, and it isn't needed for the point this post
is making.

## What macros can't say

Here's a macro that applies a function twice:

```lisp
(defmacro twice
  ((f x) `(,f (,f ,x))))
```

`(twice (lambda (n) (* n 3)) 1)` is `9`. Now give it a function that takes
two arguments:

```txt
error: expected 2 arguments, got 1
2 |   ((f x) `(,f (,f ,x))))
  |               ^^^^^^^
```

The program is wrong, and the compiler says so before it runs. But look
where the caret is: inside the macro's definition, on a call the user never
wrote. The user wrote `(twice (lambda (a b) a) 1)`. What the compiler
checked was the expansion,
`((lambda (a b) a) ((lambda (a b) a) 1))`.

That's the Lisp Curse again, in a smaller form. Patterns check a macro
call's *shape*, but `twice` has no type. Nothing in the program says
"`twice` takes a one-argument function and a value". The checker can't say
it, an editor can't show it, and the user only finds out by reading the
template. Every macro adds a word to the language, and none of them adds a
rule the compiler can check at the place the word is used.

To try it, put Parts 2 through 6 in directories named `02` to `06`, this
post's files in `07`, install `effect` version 4, and run this with Node 24
from inside `07`:

```ts
import { Effect } from "effect";
import { expansion } from "./run.ts";

const source = `
(defmacro -> ((x) x)
  ((x (f &rest args) &rest steps) \`(-> (,f ,x ,@args) ,@steps)))
(-> 5 (+ 1) (* 2))`;
console.log(Effect.runSync(expansion(source))); // (* (+ 5 1) 2)
```

## What's next

Macros made the language extensible in itself, which is what Lisp is famous
for. Rewriting is the easy part, though. The hard part is that each new form
should come with its own rule: what its arguments must be, what names it
binds and with which types, and what type the whole form has. Then the
checker could report `(twice (lambda (a b) a) 1)` at the call, in terms of
`twice`.

That's a different kind of extension: not a rewrite that runs before the
checker, but a form that takes part in checking. It's the idea Forma is
built around, and the subject of the next post.

**Next:** Part 8, *The Prelude Is the Language*. A small kernel, many
languages.

<p class="blog-source">The code in this post lives in
<a href="https://github.com/bjacobso/forma/tree/main/docs/snippets/blog/in-the-beginning/07"><code>docs/snippets/blog/in-the-beginning/07</code></a>
and runs in the site's test suite.</p>
