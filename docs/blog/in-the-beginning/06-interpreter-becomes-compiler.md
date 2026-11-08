---
title: The Interpreter Becomes a Compiler
description: Part 6 of In the Beginning Was the Schema. Elaborate surface syntax into a small typed core with resolved names, run core with an evaluator that trusts it, and save compiled core as a Schema-checked artifact.
---

# The Interpreter Becomes a Compiler

<p class="blog-meta">Part 06 of <a href="/blog/in-the-beginning/">In the Beginning Was the Schema</a> · Act II, Logos · <time datetime="2026-11-08">November 8, 2026</time></p>

> Syntax is what you write. Core is what it means.

[Part 5](/blog/in-the-beginning/05-types-before-execution) put a type checker
in front of the evaluator, and ended by pointing out how little the two
share. The pipeline was:

```ts
parse(source).pipe(
  Effect.tap(check),
  Effect.flatMap((expr) => evaluate(expr, globals)),
);
```

`check` works out a type for every expression, and `tap` throws all of them
away. Then `evaluate` walks the same surface tree again. It looks up every
name by string, again. It still checks for unbound names, calls to
non-functions, wrong argument counts, and non-numbers passed to `+`. None
of those can happen in a program that checked.

This post makes checking *produce* something: a second, smaller language
called the **core**, where everything the checker learned is written into
the tree. The step from surface syntax to core is called **elaboration**.
Once it exists, the program has two halves: a front end that turns source
into core, and a back end that runs core without ever seeing source. That
split is what makes it a compiler.

## Two languages

The surface language, from Part 4, is what people write. Its `Ref` is a
name, and what it refers to is a question someone has to answer later. Its
nodes have spans but no types.

The core language answers those questions up front:

<<< @/snippets/blog/in-the-beginning/06/core.ts#core

Three things changed.

- **Every node has a type.** The checker's work isn't thrown away; it's
  stored on the node it describes.
- **Names are gone.** A `Ref` becomes either a `Global`, one of the
  built-ins, or a `Local` with a **depth** (how many frames out) and a
  **slot** (which parameter in that frame). The `name` field stays only so
  people can read it.
- **Nothing is ambiguous.** A surface `Call` might call anything. A core
  `Call` has a function type on its `fn`, and the right number of `args`.

The core is still described by a schema, like the syntax in Part 2 and the
types in Part 5. That will matter at the end of the post.

## Elaboration

At compile time, a frame records the parameters' names and types:

<<< @/snippets/blog/in-the-beginning/06/elaborate.ts#frame

The elaborator is Part 5's checker with one change. Every case used to
return a type; now it returns a core node that *has* a type:

<<< @/snippets/blog/in-the-beginning/06/elaborate.ts#elaborate

`ref` is where names stop being names. It walks outward through the frames,
counting, until it finds the parameter, and records where it was found.
Shadowing falls out of the walk: the innermost frame is checked first.

`settle` is new. During inference, a node's type may be an unknown that
only gets solved later, such as a parameter whose type is decided by how
the body uses it. Once inference is finished, `settle` resolves every
node's type, so the core that comes out holds final answers.

## Reading core

Here is `((lambda (x) (+ x 1)) 41)` after elaboration, printed one node per
line:

<<< @/snippets/blog/in-the-beginning/06/core.ts#show

```txt
call : Num
  lambda (x) : (Num) -> Num
    call : Num
      global + : (Num...) -> Num
      local x @0.0 : Num
      lit 1 : Num
  lit 41 : Num
```

`x` is now `@0.0`: zero frames out, slot zero. A name from an enclosing
function points further out. In `((lambda (x) ((lambda (y) x) 2)) 1)`, the
inner `x` elaborates to `local x @1.0`.

Polymorphic built-ins are settled at each use, too. `print` has type
`('a) -> 'a` in general, but in `(print (quote hi))` the core records the
one type it has *there*:

```txt
call : Data
  global print : (Data) -> Data
  datum hi : Data
```

Unknowns that stay unknown stay in the core as type variables, which is
just what a polymorphic function looks like:

```txt
lambda (f x) : (('a) -> 'a, 'a) -> 'a
  call : 'a
    local f @0.0 : ('a) -> 'a
    call : 'a
      local f @0.0 : ('a) -> 'a
      local x @0.1 : 'a
```

## Checking is elaboration

There's no separate `check` any more. The type of a program is the type at
the root of its core:

<<< @/snippets/blog/in-the-beginning/06/run.ts#run

The site's tests run the programs from Part 5 through both, and they give
the same types and the same errors, at the same spans.
`((lambda (x) (+ x 1)) (quote a))` still fails before anything runs, with
the caret on `(quote a)`.

## A runtime that trusts its input

The back end runs core. Its values look like Part 4's, except that a
runtime frame holds values in slots and has no names:

<<< @/snippets/blog/in-the-beginning/06/execute.ts#values

Here is the whole evaluator:

<<< @/snippets/blog/in-the-beginning/06/execute.ts#execute

Compare it with Part 4's. Looking up a `Local` walks a fixed number of
frames and reads an array, with no string comparisons and no chance of
finding the wrong binding. Calling a closure doesn't count its arguments.
And the error type has shrunk. Part 4's evaluator could fail with
`UnboundName`, `NotCallable`, `WrongArity`, `NotANumber`, or `DivByZero`.
This one can fail with `DivByZero`, and that's all:

```ts
run: (source: string) =>
  Effect<Value, Diagnostic | CheckError | DivByZero, Output>
```

Read that type as two phases. `Diagnostic | CheckError` is everything the
front end can reject. `DivByZero` is the only thing a checked program can
still do wrong, because types say what *kind* of value an expression
produces, not *which* value.

## Failures and defects, again

The checks didn't all vanish. A few are still there, because the evaluator
handles cases that "can't happen", such as a `Local` with no slot or a call
to a number. What changed is what they mean:

<<< @/snippets/blog/in-the-beginning/06/execute.ts#broken

Part 3 drew the line between failures, which mean the *program* is wrong,
and defects, which mean the *interpreter* is. These checks have moved
across it. If one fires, the core broke its own promise. That's a bug in
the compiler, so it's a defect and stays out of the error type. The same
goes for the primitives, which used to report `NotANumber` and now treat a
non-number as broken core:

<<< @/snippets/blog/in-the-beginning/06/execute.ts#globals

## Compile now, run later

So far `run` still does both halves in one call. Because core is data with
a schema, the halves can happen at different times, in different places:

<<< @/snippets/blog/in-the-beginning/06/run.ts#artifact

`build("(+ 1 2)")` produces a JSON artifact. It's verbose, because every
node carries its type and span, but it's plain data (abbreviated here):

```txt
{"_tag":"Call",
 "fn":{"_tag":"Global","name":"+","type":{"_tag":"TFun",...},...},
 "args":[{"_tag":"Lit","value":1,"type":{"_tag":"TNum"},...},
         {"_tag":"Lit","value":2,"type":{"_tag":"TNum"},...}],
 "type":{"_tag":"TNum"},"span":{"start":0,"end":7}}
```

`load` turns it back into core, and `execute` runs it, with no reader,
parser, or checker involved. That's the classic shape of a compiler: it
translates one language into another, and the output runs on something
that doesn't know the input language. Our target is a tree, not machine
code. Compiling core further, to JavaScript or bytecode, would be the same
step again.

Decoding does real work: a malformed artifact, such as a `Lit` whose
`value` is a string, fails with a path to the problem. But it's worth being
exact about what it checks. Schema proves the artifact has the *shape* of
core. It doesn't prove the types written in it are true. Edit the JSON so
the call's function is `pi` instead of `+`, and it still decodes. Running
it doesn't fail with an `EvalError`; it dies with a defect:

```txt
ill-typed core: 3.141592653589793 is not a function
```

That's the line from the previous section, working as designed: tampered
core is broken core. Real compilers often close this gap by re-checking
core before running it. Because every node is already typed, that check
needs no inference and is cheap; GHC's Core Lint is the classic example.
We'll leave it out for now.

To try it, put Parts 2 through 5 in directories named `02` to `05`, this
post's files in `06`, install `effect` version 4, and run this with
Node 24 from inside `06`:

```ts
import { Effect } from "effect";
import { consoleOutput, Output } from "../04/capabilities.ts";
import { display, execute } from "./execute.ts";
import { build, load } from "./run.ts";

const json = Effect.runSync(build("(+ (print 1) (print 2))"));
// ...later, somewhere else:
const program = load(json).pipe(
  Effect.flatMap((core) => execute(core, undefined)),
  Effect.provideService(Output, consoleOutput),
);
console.log(display(Effect.runSync(program))); // 1, 2, then 3
```

## What's still missing

The core is small on purpose: numbers, data, names, functions, and calls.
Every program the language can express comes down to those six nodes.

That makes the next question pressing. Suppose we want `let`. We don't need
a new core node, because `let` is already expressible:

```lisp
(let ((x 1)) (+ x x))
; means
((lambda (x) (+ x x)) 1)
```

So `let` belongs in the surface language, as a rewrite into forms that
already exist. That's Part 1's `square` again: a function from trees to
trees, run before elaboration. Today the only place to write that function
is the compiler's TypeScript source, in the parser, which every new form
would touch. And Part 1 already warned that a careless rewrite can
duplicate work or capture the wrong variable.

The fix is to let programs write those rewrites themselves, in the
language, safely. That's what macros are for.

**Next:** [Part 7, *Macros Are Programs About Programs*](/blog/in-the-beginning/07-macros).
The compiler can be extended in its own language.

<p class="blog-source">The code in this post lives in
<a href="https://github.com/bjacobso/forma/tree/main/docs/snippets/blog/in-the-beginning/06"><code>docs/snippets/blog/in-the-beginning/06</code></a>
and runs in the site's test suite.</p>
