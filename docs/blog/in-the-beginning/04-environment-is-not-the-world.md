---
title: The Environment Is Not the World
description: Part 4 of In the Beginning Was the Schema. Add lambda, closures, and lexical scope, and separate the names a program defines from the capabilities a host grants through Effect services.
---

# The Environment Is Not the World

<p class="blog-meta">Part 04 of <a href="/blog/in-the-beginning/">In the Beginning Was the Schema</a> · Act I, Genesis · <time datetime="2026-11-08">November 8, 2026</time></p>

> Names resolve in scopes. Capabilities resolve through services.

[Part 3](/blog/in-the-beginning/03-errors-are-not-exceptions) gave the
evaluator an honest type, `Effect<Value, EvalError, Environment>`, and left a
crack in the third slot. The `Environment` was one flat map that the host
chose before the program started. Two very different things lived in it:

- **Names**, like `+` and `pi`. They're part of the language's vocabulary,
  and soon programs will define their own.
- **Capabilities**, like a future `print` or `read-file`. These are things
  the host does on the program's behalf, and a sandbox might refuse them.

This post adds functions, which forces the question of where names live.
The answer splits the environment in two. Names go into **scopes**: plain
data that the evaluator passes around and closures keep. Capabilities go
into **services**: Effect's context, which the host fills in when it runs
the program.

## Functions

The language gets exactly one new form, `lambda`:

```lisp
((lambda (x) (* x x)) 7)                      ; => 49
(((lambda (n) (lambda (x) (+ x n))) 10) 5)    ; => 15
```

The second line is the important one. A function returns a function, and
the returned function still remembers `n` after the outer call is finished.

The abstract syntax gains a `Lambda` node, and `Call` changes in one place.
Its operator used to be a `Ref`; now it's any expression. That's the change
Part 2 promised for this post:

<<< @/snippets/blog/in-the-beginning/04/expr.ts#expr

Parsing `lambda` follows Part 2's pattern. Each malformed shape fails with a
diagnostic that points at the cause:

<<< @/snippets/blog/in-the-beginning/04/expr.ts#lambda

```txt
error: x is already a parameter
1 | (lambda (x x) x)
  |            ^
```

There's still no `let`. You can write it as an immediately called lambda,
`((lambda (x) body) 3)`, which is what `let` *is*. Parts 7 and 8 bring it
back as a form defined outside the kernel, rather than one more case in the
evaluator.

## Scopes are data

A **scope** is a frame of names plus the scope around it. Looking up a name
walks outward until it finds the name or runs out of frames:

<<< @/snippets/blog/in-the-beginning/04/scope.ts#scope

A scope is an ordinary immutable value, not a service, a global variable, or
a mutable table. That matters because a function value has to hold on to
one. A **closure** is a function's parameters and body, together with the
scope it was created in:

<<< @/snippets/blog/in-the-beginning/04/scope.ts#values

## The evaluator

The evaluator now takes the scope as an argument, and its result type
mentions `Output` where Part 3 mentioned `Environment`. We'll get to
`Output` shortly.

<<< @/snippets/blog/in-the-beginning/04/evaluate.ts#evaluate

`Lambda` captures the current scope in a closure. `Ref` looks the name up
in the scope it's given. `Call` evaluates the operator and arguments, then
runs a closure's body in a new frame that binds its parameters. A closure
called with the wrong number of arguments gets a new tagged error:

<<< @/snippets/blog/in-the-beginning/04/errors.ts#errors

The evaluator is written with a parameter, `rule`, that decides which scope
the new frame extends. The next section shows why that one line is the
whole question.

## Which scope?

When a function body runs, which scope does it see? There are two
reasonable answers:

<<< @/snippets/blog/in-the-beginning/04/evaluate.ts#rule

**Lexical** scope extends the scope where the function was *written*.
**Dynamic** scope extends the scope where it was *called*. One program
tells them apart:

```lisp
((lambda (x)
   ((lambda (f)
      ((lambda (x) (f 0)) 100))
    (lambda (y) (+ x y))))
 1)
```

The function `f` is written where `x` is `1`, and called where a different
`x` is `100`. Under the lexical rule, the program returns **1**. Under the
dynamic rule, it returns **100**.

Lexical scope is the right rule for names, for the same reason it won in
almost every language since Scheme. You can tell what `x` means by reading
the code around it. A function means the same thing wherever it's called.
And a function can't be broken by a caller that happens to use the same
variable name.

## Why names can't be services

Part 3 kept names in an Effect service, and this is where that stops
working. Effect's context resolves requirements where an effect *runs*, not
where it was *built*. Here's that rule, using a service in place of a
variable:

<<< @/snippets/blog/in-the-beginning/04/services.ts#services

The effect `body` was created inside a region where `X` is `1`, and run
inside one where `X` is `100`. It sees `100`. Effect's context is dynamically
scoped, by design.

So if program names lived in services, every closure would see its caller's
variables, and `f` above would return `100`. That's the wrong rule for
names. But for capabilities, it's exactly the right one.

## Capabilities

The question a capability answers isn't "what did the author mean by this
name?" It's "what is this run of the program allowed to do, and how?" The
answer belongs to whoever runs the program, which is what dynamic
resolution provides.

The first capability is output:

<<< @/snippets/blog/in-the-beginning/04/capabilities.ts#output

The global scope binds the names every program starts with. `print` is one
of them, an ordinary primitive. What printing *does* is not in the scope;
the primitive asks the `Output` service:

<<< @/snippets/blog/in-the-beginning/04/scope.ts#globals

`run` starts every program in the global scope, and leaves `Output` in the
type:

<<< @/snippets/blog/in-the-beginning/04/run.ts#run

That type is a contract. Try to run the program without saying where output
goes, and it doesn't compile:

```ts
Effect.runSync(run("(print 1)"));
// Type 'Output' is not assignable to type 'never'.
```

The host provides the capability, and it can provide a different one each
time. Here is one program run in two worlds:

<<< @/snippets/blog/in-the-beginning/04/worlds.ts#worlds

`quiet()` returns the result `3` and the lines `["1", "2"]` without
touching the console. The tests for this post work that way.

To try it, put Part 2's files in a directory named `02`, Part 3's in `03`,
and this post's in `04`, install `effect` version 4, and run this with
Node 24 from inside `04`:

```ts
import { Effect } from "effect";
import { consoleOutput, Output } from "./capabilities.ts";
import { run } from "./run.ts";
import { display } from "./scope.ts";

const program = run("(((lambda (n) (lambda (x) (+ x n))) 10) 5)");
const value = Effect.runSync(
  program.pipe(Effect.provideService(Output, consoleOutput)),
);
console.log(display(value)); // 15
```

## The split, in one line

A program can shadow the *name* `print`:

```lisp
((lambda (print) (+ print 1)) 41)   ; => 42
```

Inside that function, `print` is just `41`. That's lexical scope doing its
job, and it's the author's business. What the program can't do is change
what printing does, or print when the host hasn't granted `Output`. That's
the host's business. The two concerns now sit in two separate places in
the code: the `scope` argument and the `R` slot of the Effect.

## What's still missing

Two cracks are left, and they're the subject of the next two acts.

The first is about values. This program parses, and every name in it is
bound:

```txt
error: + expects numbers, got a
1 | ((lambda (x) (+ x 1)) (quote a))
  |                 ^
```

It fails only when it runs, and the error points inside the function body,
at `x`, rather than at `(quote a)`, the argument that caused the problem.
Knowing *before* running that a function expecting a number has been given
a symbol takes a type checker. That starts Act II.

The second is about capabilities. `Output` is in the type of *every*
program, including `(+ 1 2)`, because the type comes from the TypeScript
interpreter, not from the program. The interpreter knows a program *might*
print; it doesn't know which programs do. Making a program's own type say
which capabilities it needs is Part 9's job.

**Next:** Part 5, *Types Before Execution*. `(+ 1 "hello")` should be a
type error before evaluation.

<p class="blog-source">The code in this post lives in
<a href="https://github.com/bjacobso/forma/tree/main/docs/snippets/blog/in-the-beginning/04"><code>docs/snippets/blog/in-the-beginning/04</code></a>
and runs in the site's test suite.</p>
