---
title: The Agent Can Read the Language
description: Part 11 of From Lists to Languages. Give a coding agent tools instead of a text buffer, including a report on the file, types at positions, a rename the checker proves safe, structured replacement, and a sandboxed REPL, each with a Schema for its input and output.
---

# The Agent Can Read the Language

<p class="blog-meta">Part 11 of <a href="/blog/in-the-beginning/">From Lists to Languages</a> · Act III, Effects in Practice · <time datetime="2026-11-08">November 8, 2026</time></p>

> The agent doesn't have to guess what the program means.

A coding agent usually works the way a person with a plain text editor
would. It reads characters, writes characters, and runs something to find
out whether it worked. Here's a typical request: rename `x` to `y`.

```lisp
(let ((x 2) (y 5)) (+ x y))   ; => 7
```

A text edit replaces every `x`:

```lisp
(let ((y 2) (y 5)) (+ y y))   ; => 10
```

The result reads, checks, and runs. It's also wrong, and nothing says so:
the second binding of `y` now hides the first.

Text edits go wrong a second way, because quoted data looks like code:

```lisp
(let ((n 2))
  (do (print 'n) (* n n)))
```

Replacing every `n` with `count` also changes what the program prints.
`'n` is a symbol the program prints, not a reference to the variable.

[Part 10](/blog/in-the-beginning/10-many-interpretations) built tools that
read a program's representations. This post hands them to an agent, and
adds edits that work on those representations too.

## What a program means

To know whether an edit is safe, we have to say when two programs mean the
same thing. Core almost says it already. [Part 6](/blog/in-the-beginning/06-interpreter-becomes-compiler)
turned every name into a position, so two programs that differ only in
their names elaborate to the same core, apart from the names kept for
display and the spans. Drop those, and compare:

<<< @/snippets/blog/in-the-beginning/11/meaning.ts#meaning

`Schema.toEquivalence` derives structural equality from the same `Core`
schema that Part 6 used to save compiled artifacts. This kind of equal
meaning is strict: it's the same core, not just the same answer. `(+ 1 2)`
and `3` mean different things by this measure, and for a rename, that's
the right side to err on.

## Renaming by asking the checker

A rename starts from the symbol under the cursor. The candidates are the
symbols with the same name that the program could be referring to.
Symbols inside quoted data aren't candidates, and neither are symbols
inside macro definitions, which belong to the macro:

<<< @/snippets/blog/in-the-beginning/11/meaning.ts#occurrences

Core says which of those are references, and to what. A `Local` that's
`depth` functions out refers to a parameter of that function:

<<< @/snippets/blog/in-the-beginning/11/rename.ts#references

What core doesn't say is where each binder was written. `let` and
`lambda` both put their names into a core `Lambda`, but which symbol in the
source was the parameter is up to the form, and since
[Part 8](/blog/in-the-beginning/08-prelude-is-the-language) forms belong
to the prelude. An editor shouldn't have to know every form. So the rename
asks the checker instead. Each candidate edit renames the references plus
one possible binder, and the right candidate is the one that leaves the
meaning unchanged:

<<< @/snippets/blog/in-the-beginning/11/rename.ts#rename

A rename that can't be made safely is refused, with a reason and a span:

<<< @/snippets/blog/in-the-beginning/11/rename.ts#refused

Here's the opening example, renamed with the tool:

```lisp
(let ((x 2) (y 5)) (+ x y))
; rename x to z
(let ((z 2) (y 5)) (+ z y))
; rename x to y
; refused: renaming x to y would change what the program means
```

The quoted `'n` is left alone:

```lisp
(let ((count 2))
  (do (print 'n) (* count count)))
```

Pointing the cursor at the quoted `n` itself is refused with
`this n is data, not a name`. Shadowed names are told apart, because their
references point at different functions:

```lisp
(let ((x 1)) (+ x ((lambda (x) (* x 10)) 3)))
; rename the outer x to y
(let ((y 1)) (+ y ((lambda (x) (* x 10)) 3)))
; rename the inner x to y
(let ((x 1)) (+ x ((lambda (y) (* y 10)) 3)))
```

Since Part 8, a local name can shadow a form's name. So renaming `x` to
`if` is fine in `(lambda (x) (+ x 1))`, which becomes
`(lambda (if) (+ if 1))`. In `(lambda (x) (if x 1 2))` it's refused,
because `(if if 1 2)` would call the parameter instead of using the form.
The rename tool doesn't know that rule. The checker does, and the rename
asks it.

Two more cases are refused by design. Renaming `print` is refused with
`print belongs to the prelude`: that would change the language, not the
program. And a name used inside a macro's expansion is left to the macro:

```lisp
(defmacro sq ((e) `((lambda (v) (* v v)) ,e)))
(let ((v 3)) (sq v))
; rename the second v to w
(let ((w 3)) (sq w))
```

The macro's `v` isn't touched. Part 7's expander is hygienic, so the
macro's `v` and the user's `v` were never the same name.

This approach has a cost. Every candidate is a full check, so a name with
*k* occurrences can mean up to *k* checks. That's fine for one file. A
real tool would keep each binder's span in core, which the Part 10
analyzer wanted too.

## Replacing an expression

The other edit agents make constantly is "replace this with that". As a
text edit, it can leave half an expression behind. As a structured edit,
it can't:

<<< @/snippets/blog/in-the-beginning/11/edit.ts#replace

```txt
source: (do (print 1) (+ 1 2))

(+ 1 2)   with (* 3 4)  ->  (do (print 1) (* 3 4))
"(+ 1 2"  with x        ->  no expression starts and ends there
(+ 1 2)   with "(* 3 4" ->  this ( is never closed
(+ 1 2)   with "1 2"    ->  the replacement must be one expression
```

`replace` guarantees that the file still reads. It doesn't guarantee that
the file checks, and it shouldn't refuse an edit that doesn't: an agent
sometimes has to pass through a broken program to reach a working one.
Instead, every edit returns Part 10's report on the result, so the agent
sees the type and findings of what it just made.

## Tools

An agent talks to tools through a narrow interface: a name, a
description, a JSON Schema for the input, and JSON in and out. Each part
of that is something the language already has:

<<< @/snippets/blog/in-the-beginning/11/tools.ts#tool

The file lives in a service. That's [Part 4](/blog/in-the-beginning/04-environment-is-not-the-world)'s
idea again: the tools say what they need, and whoever runs them provides
it, whether that's a test, an editor, or a disk.

<<< @/snippets/blog/in-the-beginning/11/tools.ts#workspace

There are five tools:

<<< @/snippets/blog/in-the-beginning/11/tools.ts#tools

`evaluate` is a REPL, and it's a host from
[Part 9](/blog/in-the-beginning/09-effects-are-part-of-the-type). It allows
`Output` and `DivByZero`, so an expression that needs anything else is
refused before it runs:

<<< @/snippets/blog/in-the-beginning/11/tools.ts#evaluate

Calling a tool decodes the agent's JSON with the tool's input schema, runs
the tool, and encodes the result with its output schema. Every problem
comes back in the same shape, a message and a span: bad input, a refused
edit, a type error, or a division by zero.

<<< @/snippets/blog/in-the-beginning/11/tools.ts#call

What the agent is told about each tool is derived from the same schemas:

<<< @/snippets/blog/in-the-beginning/11/tools.ts#manifest

```json
{"name": "rename",
 "description": "Rename the name at a position, ...",
 "input": {
  "type": "object",
  "properties": {
   "at": {"type": "integer", ...,
          "description": "A position in the file, counting from 0"},
   "to": {"type": "string"}},
  "required": ["at", "to"]}}
```

## A session

Here's what an agent sees, working on the opening example. Each line
starting with `>` is a call, and the line after it is the answer (wrapped
here to fit):

```txt
> read {}
{"source": "(let ((x 2) (y 5)) (+ x y))",
 "report": {"formatted": "(let ((x 2) (y 5)) (+ x y))",
            "type": "Num", "findings": []}}

> type_at {"at": 20}
{"type": "(Num...) -> Num"}

> type_at {"at": "20"}
{"error": {"message": "Expected number\n  at [\"at\"]",
           "span": {"start": 0, "end": 0}}}

> rename {"at": 7, "to": "y"}
{"error": {"message":
   "renaming x to y would change what the program means",
   "span": {"start": 7, "end": 8}}}

> rename {"at": 7, "to": "base"}
{"source": "(let ((base 2) (y 5)) (+ base y))",
 "report": {"formatted": "(let ((base 2) (y 5)) (+ base y))",
            "type": "Num", "findings": []}}

> evaluate {"expression": "(do (print 1) (/ 6 2))"}
{"value": "3", "printed": ["1"]}

> evaluate {"expression": "(sleep 10)"}
{"error": {"message": "unhandled effect: Async",
           "span": {"start": 0, "end": 10}}}
```

The agent never had to guess. It asked for a type and got one. It asked
for an unsafe rename and got a refusal, with a reason, pointing at the
name. It asked to run something the REPL doesn't allow, and nothing ran.

Side by side:

| | Editing text | Using the tools |
| --- | --- | --- |
| What the agent reads | Characters | Syntax, types, findings |
| How it learns an edit worked | Runs something | The report after every edit |
| Renaming | Find and replace | References, checked |
| Quoted data | Edited like code | Left alone |
| Half an expression | Possible | Refused |
| Running code | Whatever the shell allows | Only allowed effects |

## What the tools don't do

They work on one file. Equal meaning is strict, so a refactoring that
changes core, such as inlining a function, can't be checked this way. An
agent can still write a wrong program that type-checks: types say what
kind of value a program returns, not which value, so tests still matter.
And the tools don't decide what to change. They make the agent's guesses
checkable.

To try it, put Parts 2 through 10 in directories named `02` to `10`, this
post's files in `11`, install `effect` version 4, and run this with Node
24 from inside `11`:

```ts
import { Effect } from "effect";
import { standard } from "../09/prelude.ts";
import { rename } from "./rename.ts";

const source = "(let ((x 2) (y 5)) (+ x y))";
console.log(Effect.runSync(rename(standard, source, 7, "z")));
// (let ((z 2) (y 5)) (+ z y))
```

## What's next

Eleven posts built one language a piece at a time. Every piece took one of
three things: Lisp's trees, Schema's descriptions, or Effect's runtime.

The last post puts those pieces to work on something that isn't a
language demo: a small language for a real job, built with the prelude,
checked by the kernel, and run with capabilities a host provides.

**Next:** [Part 12, *A Language for Building Languages*](/blog/in-the-beginning/12-let-there-be-languages).
The final product isn't a Lisp. It's a language-building platform.

<p class="blog-source">The code in this post lives in
<a href="https://github.com/bjacobso/forma/tree/main/docs/snippets/blog/in-the-beginning/11"><code>docs/snippets/blog/in-the-beginning/11</code></a>
and runs in the site's test suite.</p>
