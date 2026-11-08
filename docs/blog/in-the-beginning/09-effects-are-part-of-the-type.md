---
title: Effects Are Part of the Type
description: Part 9 of In the Beginning Was the Schema. Give function types a row of effects, infer them with row-polymorphic unification, add Unit, when, catch, and race, and let a host reject a program that needs a capability it doesn't have, before it runs.
---

# Effects Are Part of the Type

<p class="blog-meta">Part 09 of <a href="/blog/in-the-beginning/">In the Beginning Was the Schema</a> · Act III, Praxis · <time datetime="2026-11-08">November 8, 2026</time></p>

> The type describes not only the result, but what the computation demands.

[Part 8](/blog/in-the-beginning/08-prelude-is-the-language) ended on a
type that doesn't tell the truth. `print` has the type `('a) -> 'a`, the
same as the identity function. The checker knows that `(print 1)` is a
number, and nothing about what happens when it runs.

The interpreter itself has known the difference since
[Part 4](/blog/in-the-beginning/04-environment-is-not-the-world). Its
TypeScript type is `Effect<Value, Failure, Output>`: what it returns, how
it can fail, and which services it needs. Effect puts all three in the
type of every computation. The language we're building puts only the
first in the type of its expressions.

This post closes that gap. The language gets three effects: `Output`
for printing, `DivByZero` for the one runtime error left, and `Async` for
waiting. Each one becomes part of the type, and a host can read a
program's type to learn what running it will demand.

## A row of effects

A function type now has a fourth part: what calling the function does.

<<< @/snippets/blog/in-the-beginning/09/types.ts#type

That part is a **row**: a set of effect labels, plus maybe a variable
that stands for "and whatever else". Types are printed with the effects
after a `!`:

```txt
print : ('a) -> 'a ! {Output}
/     : (Num...) -> Num ! {DivByZero}
sleep : (Num) -> Unit ! {Async}
+     : (Num...) -> Num
```

`sleep` returns `Unit`, the type of an expression that only matters for
what it does. Its one value is the empty list.

The prelude writes every built-in's effects as an *open* row:

<<< @/snippets/blog/in-the-beginning/09/prelude.ts#values

`{Output | 'e}` means "prints, and the code calling it may also do
anything else". The `'e` is what lets a call to `print` fit inside a
function that also divides. It's left out when a type is printed, unless
it appears twice and so says something.

## Unifying rows

The solver from [Part 5](/blog/in-the-beginning/05-types-before-execution)
makes two types equal or explains why it can't. Two function types are
now equal only if their effects are, too. Rows are compared as sets:

<<< @/snippets/blog/in-the-beginning/09/solver.ts#rows

Labels that one row has and the other lacks must fit in the other's
tail. If that tail is an unknown, it learns the extra labels, and a new
unknown takes its place for anything still to come. If there's no tail,
the row is **closed** and nothing more fits. That's a new type error:

<<< @/snippets/blog/in-the-beginning/09/solver.ts#unhandled

## Where effects happen

Effects happen when a function is *called*, so the kernel's call rule
gets one more step. Every frame records what the code in it may do, and a
call's effects must fit there:

<<< @/snippets/blog/in-the-beginning/09/kernel.ts#apply

A function's body doesn't run when the function is made. So `k.lambda`
gives the body a fresh row of its own, and that row becomes the
function's effects instead of the surrounding code's:

<<< @/snippets/blog/in-the-beginning/09/kernel.ts#kernel

The difference shows up in the types. Calling `print` prints, and making
a function that will print doesn't:

```lisp
(print 1)                ; : Num ! {Output}
(lambda (x) (print x))   ; : ('a) -> 'a ! {Output}
```

The second expression does nothing yet. Its effect is **latent**: it's
in the function's type, waiting for a call.

Part 8's `let` generalizes, so the solver has to be careful which
unknowns it hands out. An unknown in the effects of an enclosing frame
belongs to the code around the `let`, just like an unknown in an
enclosing parameter's type, so `generalize` keeps those too.

## Effect polymorphism

Here's [Part 7](/blog/in-the-beginning/07-macros)'s `twice` again, as a
function:

```lisp
(let ((twice (lambda (f x) (f (f x)))))
  twice)
; : (('a) -> 'a ! 'b, 'a) -> 'a ! 'b
```

Nobody wrote that type. It says that `twice` does exactly what `f` does,
whatever that is. The variable `'b` is printed because it appears twice:
it links `f`'s effects to `twice`'s. In the same `let`, pass `print` and
the call prints; pass arithmetic and it's pure:

```lisp
(twice print 1)                   ; : Num ! {Output}
(twice (lambda (n) (* n 3)) 1)    ; : Num
```

A language without effect variables would have to choose: either every
higher-order function is assumed to do everything, or `twice` can't
accept a function that prints.

## Unit, do, and when

Part 8 left `when` out, because "does nothing when the test fails" had no
type. Now it does. Forms that run code right where it's written, like a
`let`'s body or an `if`'s branches, use a helper that gives the new
function the surrounding code's effects:

<<< @/snippets/blog/in-the-beginning/09/prelude.ts#now

That keeps diagnostics in place. When an effect isn't allowed, the error
points at the call inside the branch that does it, not at the whole `if`.

`do` runs expressions in order:

<<< @/snippets/blog/in-the-beginning/09/prelude.ts#do

And `when` is a branch whose value is always unit:

<<< @/snippets/blog/in-the-beginning/09/prelude.ts#when

```lisp
(when (< 1 2) (print 1))   ; : Unit ! {Output}
```

`Unit` is a type like `Num`, so using a `when` where a number is needed
is an ordinary type error:

```txt
error: expected Num, got Unit
1 | (+ 1 (when 1 2))
  |      ^^^^^^^^^^
```

## Typed errors

`/` can fail, and its type says so. Handling the failure should take it
out of the type, the way `Effect.catchTag` takes an error out of an
`Effect`'s error channel. `catch` and `race` both hand their parts to a
prelude function as functions with no parameters, so the prelude
function decides when, and whether, each part runs:

<<< @/snippets/blog/in-the-beginning/09/prelude.ts#delaying

The handler's whole contract is in its type:

```txt
recover : (() -> 'a ! {DivByZero | 'b}, () -> 'a ! 'b) -> 'a ! 'b
```

The body may divide, and may do anything else (`'b`). The fallback may do
the same anything else, and so may the whole call. `DivByZero` is in the
first row and in no other: that's what handling it means.

```lisp
(catch (/ 1 0) 0)              ; : Num, => 0
(catch (print (/ 1 0)) 0)      ; : Num ! {Output}
```

At runtime, `recover` is `Effect.catchTag`:

<<< @/snippets/blog/in-the-beginning/09/prelude.ts#runtime

Effects compose through user functions, too. A function that calls its
argument inside `catch` is safe whatever the argument divides by:

```lisp
(lambda (f) (catch (f 1) 0))
; : ((Num) -> Num ! {DivByZero | 'a}) -> Num ! 'a
```

## Asynchronous work

`sleep` waits, and `race` runs two computations at once. The winner's
value is the race's value, and Effect interrupts the loser:

```txt
fastest : (() -> 'a ! 'b, () -> 'a ! 'b) -> 'a ! {Async | 'b}
```

```lisp
(race (do (sleep 50) (print 1))
      (do (sleep 5) (print 2)))
; : Num ! {Async, Output}
; prints 2 and nothing else, => 2
```

The slow side is interrupted while it's asleep, so its `print` never
runs. Concurrency and interruption are the runtime's job, and Effect
already does both. The language only had to say, in a type, that this
expression needs them.

## The host decides

So far the whole program's effects are whatever it turns out to do. A
host can also say what it allows:

<<< @/snippets/blog/in-the-beginning/09/kernel.ts#root

That's a closed row at the root. Every call a program makes has to fit
in it, so a program that needs anything else is rejected before it runs:

<<< @/snippets/blog/in-the-beginning/09/run.ts#run

With nothing allowed, `(print 1)` is rejected at the call:

```txt
error: unhandled effect: Output
1 | (print 1)
  | ^^^^^^^^^
```

`(lambda (x) (print x))` is accepted, because making the function
doesn't print. Calling it does, and the error points at the call that
would:

```txt
error: unhandled effect: Output
1 | (let ((p (lambda (x) (print x)))) (+ 1 (p 2)))
  |                                        ^^^^^
```

This is where the language's effects meet Effect's. Each label stands for
one part of the `Effect` the executor builds:

- `Output` is a service in the **requirements**, `R`. The host has to
  provide it.
- `DivByZero` is a typed error in the **error channel**, `E`. The host
  has to handle it or report it.
- `Async` says the computation may suspend. The host needs
  `Effect.runPromise`; `Effect.runSync` throws on an asynchronous effect.

Here is a host that runs scripts to completion, right now:

<<< @/snippets/blog/in-the-beginning/09/run.ts#host

`(do (print 1) 2)` prints `1` and returns `2`. A script that sleeps never
starts:

```txt
error: unhandled effect: Async
1 | (do (print 1) (sleep 10))
  |               ^^^^^^^^^^
```

The checker's answer is what makes `runSync` safe here. A program that
type-checks with no `Async` in its row doesn't suspend.

## Erasure

Effects are a fact about checking. The executor never reads a type, so
once a program has been checked, its effects can go:

<<< @/snippets/blog/in-the-beginning/09/kernel.ts#erase

What's left is [Part 6](/blog/in-the-beginning/06-interpreter-becomes-compiler)'s
core, and Part 6's executor runs it. `print` is still the primitive that
asks for the `Output` service, and `/` still fails with `DivByZero`. The
only new runtime code is in the three primitives that wrap Effect:
`sleep`, `recover`, and `fastest`.

There's a cost to that, and it's worth naming. The TypeScript type of
`run` is the same for every program: it always says `Output` might be
needed and `DivByZero` might happen. The *language's* checker knows
better for each program, but TypeScript can't see its answer. A host has
to trust the checker, as `script` does.

The effect vocabulary is also fixed. The prelude names three effects, and
`catch` handles exactly one of them. A language where programs declare
their own effects and handlers, as in Koka or OCaml 5, needs the same
rows with more forms around them.

This post's prelude keeps Part 8's `quote`, `lambda`, `let`, and `if`,
adds `do`, `when`, `catch`, and `race`, and leaves `match` out to stay
short.

To try it, put Parts 2 through 8 in directories named `02` to `08`, this
post's files in `09`, install `effect` version 4, and run this with Node
24 from inside `09`:

```ts
import { Effect } from "effect";
import { typeOf } from "./run.ts";

const twice = "(let ((twice (lambda (f x) (f (f x))))) twice)";
console.log(Effect.runSync(typeOf(twice)));
// (('a) -> 'a ! 'b, 'a) -> 'a ! 'b
```

## What's next

A program's type now says what it returns, how it can fail, and what it
needs from its host. That's three questions answered without running
anything.

Every answer so far has come from the checker, though. The next post
asks what else can be built over the same typed representation: a
formatter, an analyzer, and documentation, each another interpretation
of one tree.

**Next:** Part 10, *One Program, Many Interpretations*. Programs become
things we can reason about, not just execute.

<p class="blog-source">The code in this post lives in
<a href="https://github.com/bjacobso/forma/tree/main/docs/snippets/blog/in-the-beginning/09"><code>docs/snippets/blog/in-the-beginning/09</code></a>
and runs in the site's test suite.</p>
