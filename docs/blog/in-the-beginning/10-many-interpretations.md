---
date: 2026-11-07
title: One Program, Many Interpretations
description: Part 10 of From Lists to Languages. Build a formatter, an analyzer, a hover tool, and a documentation generator whose examples are checked, over the representations the language already has, and combine them into one report with Effect.
---

# One Program, Many Interpretations

<p class="blog-meta">Part 10 of <a href="/blog/in-the-beginning/">From Lists to Languages</a> · Act III, Effects in Practice · <time datetime="2026-11-07">November 7, 2026</time></p>

> Programs become things we can reason about, not just execute.

Nine posts in, the language does one thing with a program: it runs it. The
checker exists to make running safe, and everything else serves that.

But along the way the language picked up several representations of a
program, and every one of them is data with a schema:

- **Syntax**: the s-expressions from [Part 2](/blog/in-the-beginning/02-list-became-schema),
  with a span on every node.
- **Typed core**: the six node types from [Part 6](/blog/in-the-beginning/06-interpreter-becomes-compiler),
  each with its settled type.
- **The prelude**: forms, and values with type schemes, from
  [Part 8](/blog/in-the-beginning/08-prelude-is-the-language), with
  effects since [Part 9](/blog/in-the-beginning/09-effects-are-part-of-the-type).

Running is one interpretation of these. This post builds four more: a
formatter, an analyzer, a hover tool, and a documentation generator. None
of them runs the program, and each reads only the representation it needs.

## Descriptions are data

[Part 8](/blog/in-the-beginning/08-prelude-is-the-language) ended on a
limit. A form's rule is a TypeScript function, so a tool can't learn what
`if` accepts without running it. Some tools only need to know *about* a
form: how to lay it out, how to explain it, what an example looks like.
That can be data:

<<< @/snippets/blog/in-the-beginning/10/describe.ts#describe

<<< @/snippets/blog/in-the-beginning/10/describe.ts#if-doc

The standard prelude's descriptions are decoded through `Docs`, so a bad
one is caught when it's loaded. `head: 1.5` fails with
`Expected an integer`, at `["head"]`. The rule is still a function. The
description is what the next tools read.

## A formatter

A formatter needs syntax and nothing else. The reader's shorthand runs in
reverse, so `(quote x)` prints as `'x`:

<<< @/snippets/blog/in-the-beginning/10/format.ts#flat

A list that fits on the line stays on one line. One that doesn't is split,
and *how* depends on what it is. A form keeps its first few parts on the
first line, as many as its description's `head` says, and indents the rest
by two. A call lines its arguments up under the first:

<<< @/snippets/blog/in-the-beginning/10/format.ts#layout

<<< @/snippets/blog/in-the-beginning/10/format.ts#format

So this:

```lisp
(let ((twice (lambda (f x)
  (f (f x))))) (do (print
    (twice print 1)) (when (< 1 2)
  (print 2)) (catch (/ 1 0) 0)))
```

becomes this, at a width of 40:

```lisp
(let ((twice (lambda (f x) (f (f x)))))
  (do
    (print (twice print 1))
    (when (< 1 2) (print 2))
    (catch (/ 1 0) 0)))
```

Two properties keep a formatter honest, and the tests check both, on
programs from this series at widths from 60 down to 12. Reading the output
gives back the same tree. And formatting the output again changes nothing.

Because it reads only syntax, the formatter works on programs that don't
check, such as `(+ 1 'a)`. It also can't do what a real formatter must do:
keep comments. The reader throws them away, so they never reach the tree.

## An analyzer

An analyzer reads the typed core. It reports **findings**, which are
diagnostics with a severity, and it can't fail:

<<< @/snippets/blog/in-the-beginning/10/analyze.ts#finding

Most analyses walk every node, so there's one walk:

<<< @/snippets/blog/in-the-beginning/10/analyze.ts#walk

The first analysis finds parameters nobody uses. In core, every name is a
position, so "is `x` used?" means "is there a `Local` that points at it?":

<<< @/snippets/blog/in-the-beginning/10/analyze.ts#unused

```txt
warning: x is never used
1 | (let ((x 1) (y 2)) (+ y 1))
  | ^^^^^^^^^^^^^^^^^^^^^^^^^^^
```

Core doesn't keep a span for each parameter, only for the function, so the
warning covers the whole `let`. A real tool would keep the span.

The second uses Part 9's effects. In `(do a b)`, `a`'s value is thrown
away, so `a` only matters for what it does. If it does nothing, it's dead
code:

<<< @/snippets/blog/in-the-beginning/10/analyze.ts#discarded

```txt
warning: this value is discarded, and computing it does nothing
1 | (do (+ 1 2) (print 3))
  |     ^^^^^^^
```

It reads each prelude function's *declared* row, not the type in the
core. Unification made every call's row equal to the row of the code
around it, so after checking, `(+ 1 2)` in this program has the type
`(Num...) -> Num ! {Output}`. That's sound for checking, but too coarse
for this question. The analysis is careful in one direction: it warns only
when it's sure. `(do (f 1) ...)` with a pure user function `f` isn't
flagged.

`when` gets the second analysis for free, because it's built from the
same `#do` core as `do`:

```txt
warning: this value is discarded, and computing it does nothing
1 | (when 1 2)
  |         ^
```

Analyses are independent of each other, so running them is a
`forEach` over a list:

<<< @/snippets/blog/in-the-beginning/10/analyze.ts#analyze

## Hover

An editor's hover asks a different question: what's the type of the thing
under the cursor? Every core node has a span and a type, so the answer is
the smallest node around the position:

<<< @/snippets/blog/in-the-beginning/10/analyze.ts#hover

In this program, `twice` is defined once and used once:

```lisp
(let ((twice (lambda (f x) (f (f x)))))
  (twice print 1))
```

Hovering the definition shows its general type. Hovering the use shows
the type it has *there*, after `print` and `1` decided `'a` and `'b`:

```txt
; the definition, (lambda (f x) ...)
(('a) -> 'a ! 'b, 'a) -> 'a ! 'b

; the use, twice
((Num) -> Num ! {Output | 'a}, Num) -> Num ! {Output | 'a}
```

Writing this tool found a bug. The first time I hovered the definition, it
said `(Num) -> Num`. Part 8's `generalize` skipped a scheme's own
variables *after* following the solver's answers, and both count from
zero. So once this run's variable 1 had an answer, the prelude's variable
1 seemed to have it too, and `twice` quietly stopped being polymorphic.
`(do (twice print 1) (twice print 'a))` was rejected. Parts 8 and 9 now
skip own variables first, and both have a test for it. The checker's
tests looked only at the types of whole programs, which were right. The
hover tool looked inside.

## Documentation that can't go stale

The documentation generator reads the prelude and its descriptions. A
value's entry comes from its type scheme, so it's always current. A
form's entry comes from its description, and descriptions can drift from
the rule, so every example is checked before it's printed:

<<< @/snippets/blog/in-the-beginning/10/document.ts#stale

<<< @/snippets/blog/in-the-beginning/10/document.ts#document

Part of the output:

```md
### `(if test yes no)`

yes unless test is 0, then no. Both have one type.

    (if (< 1 2) 10 20) : Num

...

- `print : ('a) -> 'a ! {Output}`

- `sleep : (Num) -> Unit ! {Async}`
```

Change `if`'s example to claim `(if 1 2 3)` has type `Data`, and
generation fails:

```txt
if: (if 1 2 3) is documented as Data, but checks as Num
```

Remove the description of `when`, and it fails with
`when: has no description`. These are doctests: the documentation is
another program the language checks.

## Composing interpretations

Each interpretation is an `Effect`, and its type says what it needs and
how it can fail:

```ts
format:   Effect<string, Diagnostic>
analyze:  Effect<ReadonlyArray<Finding>>
document: Effect<string, StaleDocs>
run:      Effect<Value, CheckError | Diagnostic | DivByZero, Output>
```

Only `run` needs a service. Only `run` can fail at runtime. The formatter
can fail only if the source can't be read. Those facts are in the types,
the same way Part 9 put them in the language's types.

Effects that say how they fail compose without `try`. Here's one report
on a program, from all of the tools at once:

<<< @/snippets/blog/in-the-beginning/10/inspect.ts#report

<<< @/snippets/blog/in-the-beginning/10/inspect.ts#inspect

`Effect.result` turns a failure into a value, so a program that doesn't
check still gets formatted, and its type error becomes one more finding.
Formatting and checking don't depend on each other, so they run side by
side.

The report is data with a schema, so it encodes to JSON. For
`(let ((x 1)) (do 0 (print 2)))`:

```json
{"formatted":"(let ((x 1)) (do 0 (print 2)))",
 "type":"Num ! {Output}",
 "findings":[
  {"severity":"warning","message":"x is never used",
   "span":{"start":0,"end":30}},
  {"severity":"warning",
   "message":
    "this value is discarded, and computing it does nothing",
   "span":{"start":17,"end":18}}]}
```

For `(+ 1 'a)`, `formatted` is still there, `type` is `null`, and the one
finding is the error `expected Num, got Data`. For `(+ 1`, nothing can be
read, and `formatted` is `null` too.

To try it, put Parts 2 through 9 in directories named `02` to `09`, this
post's files in `10`, install `effect` version 4, and run this with Node
24 from inside `10`:

```ts
import { Effect } from "effect";
import { standard } from "../09/prelude.ts";
import { standardDocs } from "./describe.ts";
import { inspect } from "./inspect.ts";

const source = "(do (+ 1 2) (print 3))";
const report = inspect(standard, standardDocs, source);
console.log(Effect.runSync(report).findings[0]?.message);
// this value is discarded, and computing it does nothing
```

## What's next

Every tool in this post is a function from a representation to an answer,
and every answer is data with a schema. None of them had to guess what the
program means: the spans say where things are, the types say what they
are, and the prelude says what the words do.

That's exactly what a coding agent needs. Today, an agent edits Lisp as
text and finds out whether it worked by running something. It could read
this report instead, and ask for a type at a position, and make edits that
are trees, not strings.

**Next:** [Part 11, *The Agent Can Read the Language*](/blog/in-the-beginning/11-agent-can-read-the-language).
The agent doesn't have to guess what the program means.

<p class="blog-source">The code in this post lives in
<a href="https://github.com/bjacobso/forma/tree/main/docs/snippets/blog/in-the-beginning/10"><code>docs/snippets/blog/in-the-beginning/10</code></a>
and runs in the site's test suite.</p>
