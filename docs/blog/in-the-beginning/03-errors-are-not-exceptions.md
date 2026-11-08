---
title: Errors Are Not Exceptions
description: Part 3 of In the Beginning Was the Schema. Rewrite the evaluator as Effect<Value, EvalError, Environment>, with Schema-backed tagged errors that point at source, selective recovery, and a clear line between program errors and interpreter bugs.
---

# Errors Are Not Exceptions

<p class="blog-meta">Part 03 of <a href="/blog/in-the-beginning/">In the Beginning Was the Schema</a> · Act I, Genesis · <time datetime="2026-11-08">November 8, 2026</time></p>

> A language runtime should know how it can fail.

[Part 2](/blog/in-the-beginning/02-list-became-schema) made parsing honest.
A program that reads but means nothing fails with a diagnostic that points
at the source. Then it handed the parsed tree to an evaluator with this
type:

```ts
evaluate: (e: Expr) => Value
```

That type is a promise the function can't keep. Evaluating
`(+ 1 (quote x))` throws a `TypeError`, and evaluating `y` throws a
`ReferenceError`. Neither error knows where in the source it happened. A
caller who wants to handle one has to wrap everything in `try`/`catch`. That
also catches every bug in the interpreter itself, because a thrown
exception doesn't say whose fault it is.

This post rewrites the evaluator so that its type tells the truth:

```ts
evaluate: (e: Expr) => Effect<Value, EvalError, Environment>
```

Read it as a sentence: evaluating an expression produces a `Value`, or
fails with an `EvalError`, and it needs an `Environment` to run.

## Name every failure

Start with the failures, because they shape everything else. Our little
language can fail at runtime in exactly four ways:

<<< @/snippets/blog/in-the-beginning/03/errors.ts#errors

Each error is a class built with `Schema.TaggedError`. That gives it three
things:

- A **tag**, such as `"NotANumber"`, so code can tell failures apart without
  comparing message strings.
- **Fields with a schema.** The failure is structured data. `NotANumber`
  records the operator, what it got, and the span to blame.
- **Yieldability.** Inside `Effect.gen`, `yield* new UnboundName(...)` fails
  the computation with that error, and the error's type joins the
  computation's error type.

The message is derived from the fields, so the data is the source of truth.
Serialized, a failure is plain JSON:

```json
{ "_tag": "NotANumber", "op": "+", "got": "x",
  "span": { "start": 5, "end": 14 } }
```

`EvalError` is the union of the four. When a fifth way to fail appears, it
gets added here, and the types follow it everywhere.

## What evaluation needs

Part 2's evaluator had its primitives built in. Every name lookup either hit
that hard-coded table or threw. Now the names a program can use live in an
**environment**, and the evaluator asks for it instead of owning it.

Values come first. A value is a number, a piece of quoted data, or a
primitive operation:

<<< @/snippets/blog/in-the-beginning/03/environment.ts#values

A primitive returns an Effect too, so its failures are typed like everything
else's. It receives each argument together with the span it came from, so
when `+` gets a symbol, it can blame that argument and not the whole call.

The environment is an Effect **service**: a typed slot that the evaluator
reads and the host fills.

<<< @/snippets/blog/in-the-beginning/03/environment.ts#environment

Here is a standard environment with three operators and one constant:

<<< @/snippets/blog/in-the-beginning/03/environment.ts#standard

Division gets its own failure. `(/ 10 0)` isn't malformed: it parses, and
every argument is a number. Only running it reveals the problem, which is
exactly the kind of error a runtime has to own.

## The evaluator

With errors named and the environment supplied, the evaluator reads almost
like the specification of the language:

<<< @/snippets/blog/in-the-beginning/03/evaluate.ts#evaluate

There's no `throw` and no `try`. Each `yield*` either produces a value or
stops evaluation with a typed error. The order of evaluation is visible in
the code: the operator first, then the arguments from left to right. The
first failure wins:

```lisp
(+ (/ 1 0) y)   ; fails with DivByZero; y is never looked up
```

Delete the `NotCallable` check and the code stops compiling, because `fn`
might be a number or quoted data, and neither has an `apply`. The compiler
now enforces part of the language's semantics.

## Running a program

Parsing, evaluation, and the environment come together in `run`:

<<< @/snippets/blog/in-the-beginning/03/run.ts#run

`Effect.provideService` fills the `Environment` slot, and it disappears
from the type. What's left is `Effect<Value, Failure>`: a value, or a parse
diagnostic, or one of the four runtime errors. That's every way a program
can go wrong, written down in one type.

Runtime failures carry spans, so they render exactly like Part 2's parse
errors:

```txt
error: + expects numbers, got x
1 | (+ 1 (quote x))
  |      ^^^^^^^^^

error: division by zero
1 | (/ 10 (+ 2 -2))
  |       ^^^^^^^^

error: pi is not a function
1 | (* 2 (pi 3))
  |       ^^

error: y is not defined
1 | (+ 1 y)
  |      ^
```

The division error points at `(+ 2 -2)`, the divisor that turned out to be
zero, not at the whole call. And programs that work, work:

```lisp
(+ 1 2)      ; => 3
(/ 10 4)     ; => 2.5
(* 2 pi)     ; => 6.283185307179586
+            ; => #<primitive +>
```

The last line is new. `+` is now an ordinary name bound to an ordinary
value, so evaluating it on its own just returns the primitive.

To try it, put Part 2's files in a directory named `02`, this post's files
in a sibling named `03`, install `effect` version 4, and run this with Node
24 from inside `03`:

```ts
import { Effect } from "effect";
import { display } from "./environment.ts";
import { run } from "./run.ts";

console.log(display(Effect.runSync(run("(/ 10 4)")))); // 2.5
```

## Handling some failures, not all

Because failures are values with tags, a host can handle exactly the ones it
cares about and let the rest through. This host decides that dividing by
zero should produce `Infinity`:

<<< @/snippets/blog/in-the-beginning/03/handle.ts#recover

`lenient("(+ 1 (/ 1 0))")` succeeds with `Infinity`. The more interesting
change is in the type. `run` fails with `Diagnostic | EvalError`, while
`lenient` fails with `Diagnostic | UnboundName | NotCallable | NotANumber`.
The handled case is gone from the type, so later code can't be asked to
handle it again or forget the others.

Compare that with `try`/`catch`, where you catch everything, inspect it,
and rethrow the rest, and the type is `unknown` the whole time.

That recovery happens in the host and covers the whole program. Recovery
*inside* the language, a program catching its own errors, needs language
constructs. Part 9 brings typed errors into the language itself.

## Failures and defects

Typed errors are for failures the language defines. What about a bug in
the interpreter? Here is a primitive that throws, the way buggy code does:

<<< @/snippets/blog/in-the-beginning/03/handle.ts#defect

Run `(+ 1 (oops))` with this environment and Effect still catches the
exception, but it doesn't call it an `EvalError`. It records it as a
**defect**: the result's `Cause` contains a defect, `index out of range`,
and no typed failures at all.

That distinction is the point. A failure means the *program* is wrong, and
the user should fix their code. A defect means the *interpreter* is wrong,
and its authors should fix theirs. Exceptions blur those two together.
Effect keeps them in separate channels, so a REPL can show a friendly
diagnostic for one and a bug report for the other.

## The environment problem

It all works, and the remaining crack is in the third slot of the type.

The `Environment` is one flat map, chosen by the host before the program
starts. A program can't bind a name of its own: there's no `let`, no
function parameters, no closures. And the map mixes two different things.
`pi` and `+` are part of the language's vocabulary. A future `read-file`
would be a capability the host grants, something a sandbox might refuse.
Putting both in one bag of names will cause trouble the moment programs
define names and the host wants to control capabilities.

Names a program defines should resolve in lexical scopes, inside the
language. Capabilities the host grants should resolve through services,
outside it. Untangling those two is the next post.

**Next:** Part 4, *The Environment Is Not the World*. Names resolve in
scopes. Capabilities resolve through services.

<p class="blog-source">The code in this post lives in
<a href="https://github.com/bjacobso/forma/tree/main/docs/snippets/blog/in-the-beginning/03"><code>docs/snippets/blog/in-the-beginning/03</code></a>
and runs in the site's test suite.</p>
