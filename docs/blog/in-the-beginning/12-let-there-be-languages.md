---
date: 2026-11-07
title: A Language for Building Languages
description: Part 12 of From Lists to Languages. Declare forms in the language itself, build a vendor-review policy language from them, run it with Effect services a host provides, and see how the pieces add up to a language-building platform.
---

# A Language for Building Languages

<p class="blog-meta">Part 12 of <a href="/blog/in-the-beginning/">From Lists to Languages</a> · Act III, Effects in Practice · <time datetime="2026-11-07">November 7, 2026</time></p>

> The final product isn't a Lisp. It's a language-building platform.

Eleven posts built a language. This one uses it to build another one, for
a job that has nothing to do with languages.

The job is vendor review. A company buys software from vendors, and each
vendor has a risk score in a directory somewhere. When a vendor's score
goes over a limit, someone has to approve it: security for some vendors,
finance for others. The rules change often, the people who change them
aren't programmers, and the rules have to be safe to run.

That's what this series has been building toward:

- People write the rules in a small language that speaks their terms.
- The language's forms are declared in the language, not in TypeScript.
- The checker says what each rule will do before it runs.
- Hosts decide what the rules may do, with Effect services.
- Editors and agents read the rules with the tools from Parts 10 and 11.

## Capabilities

A policy needs two things from the world: a vendor's risk score, and a
way to ask someone for an approval. Each is an Effect service, as `Output`
has been since [Part 4](/blog/in-the-beginning/04-environment-is-not-the-world):

<<< @/snippets/blog/in-the-beginning/12/capabilities.ts#services

The language gets two new values, and their types name their effects, as
in [Part 9](/blog/in-the-beginning/09-effects-are-part-of-the-type):

<<< @/snippets/blog/in-the-beginning/12/capabilities.ts#values

```txt
risk : (Data) -> Num ! {Directory}
ask  : (Data, Data) -> Unit ! {Approvals}
```

The values are built from whatever capabilities they're given. A host
that only checks programs passes `unavailable`. That's safe because of
Part 9: a program that would call `risk` has `Directory` in its type, and
a host that doesn't allow `Directory` rejects the program before it
starts.

## Forms in the language

[Part 7](/blog/in-the-beginning/07-macros)'s macros were written in the
language, and the checker couldn't speak for them.
[Part 8](/blog/in-the-beginning/08-prelude-is-the-language)'s forms
brought their own rules, but they were TypeScript functions.
[Part 10](/blog/in-the-beginning/10-many-interpretations) described forms
as data, but separately from their rules. A declared form is all three at
once. It's written in the language, it states its rule as data, and the
kernel enforces that rule:

<<< @/snippets/blog/in-the-beginning/12/vendor.lisp{lisp}

A slot is either a `Name`, a bare symbol like `acme`, or an expression
with a type. The template says what the form means, using forms and
values the language already has. Inside the template, `,name` is the
symbol the user wrote, so `',name` is that symbol as data. `vendor`'s
template uses `review`, which is declared just above it.

A declaration is data with a schema:

<<< @/snippets/blog/in-the-beginning/12/defform.ts#declared

Reading one checks its shape, and that every hole names a slot:

<<< @/snippets/blog/in-the-beginning/12/defform.ts#declare

## Two audiences, two places

Part 7 ended on the Lisp Curse in a small form. A macro's mistakes and
its user's mistakes were reported in the same place, inside the
expansion, where neither the macro's author nor its user had written
anything. A declared form has two audiences, and each gets its own
errors.

The form's author gets errors in the template, when the form is loaded.
Each hole is filled with a stand-in of its kind, and the template is
checked once, before any program uses it:

<<< @/snippets/blog/in-the-beginning/12/defform.ts#verify

Forget the quote in `(risk ',name)`, and loading `vendor.lisp` fails
there:

```txt
error: name is not defined
7 |   `(when (< ,limit (risk ,name))
  |                          ^^^^^
```

Misspell a hole, and that fails too:

```txt
error: a hole is , and the name of a slot
7 |   `(when (< ,limt (risk ',name))
  |             ^^^^^
```

The form's user gets errors at the call. The call is checked against the
declaration before the template is used:

<<< @/snippets/blog/in-the-beginning/12/defform.ts#form

```txt
error: expected Num, got Data
1 | (vendor acme 'high security)
  |              ^^^^^
```

```txt
error: vendor takes name, limit, and owner
1 | (vendor acme 70)
  | ^^^^^^^^^^^^^^^^
```

```txt
error: vendor's name must be a name
1 | (vendor 'acme 70 security)
  |         ^^^^^
```

Every node the template contributes gets the call's span, which is what
`fill`'s `at` is for:

<<< @/snippets/blog/in-the-beginning/12/defform.ts#fill

So anything that goes wrong inside a template points at the call that
used the form, never into `vendor.lisp`, a file the user may never have
seen.

Templates are hygienic in both directions. Values from the user's
arguments are bound to names like `#limit`, which no program can write,
so a template can't capture them. And the names a template uses mean what
they mean in the prelude. If a local at the call hides one, the call is
refused instead of quietly meaning something else:

<<< @/snippets/blog/in-the-beginning/12/defform.ts#hygiene

```txt
error: a local risk hides the risk vendor uses
1 | ((lambda (risk) (vendor acme 70 security)) 5)
  |                 ^^^^^^^^^^^^^^^^^^^^^^^^^
```

That's the other half of hygiene that Part 7 left out, done by refusing
instead of renaming. Renaming would need the scope machinery that Part 7
pointed to.

## Loading a language

A prelude file is read form by form. Each form is declared, verified
against the forms above it, and added:

<<< @/snippets/blog/in-the-beginning/12/language.ts#load

<<< @/snippets/blog/in-the-beginning/12/language.ts#language

The base is Part 9's language: its forms, its values, and the two new
ones. Part 10's form descriptions come from the declarations:

<<< @/snippets/blog/in-the-beginning/12/defform.ts#doc

## A policy

Here's a policy, written by someone who knows the vendors and not the
compiler:

```lisp
(do
  (vendor acme 70 security)
  (vendor globex 90 finance)
  (vendor initech 50 security))
```

Before it runs, its type says what it will do:

```txt
Unit ! {Approvals, Directory}
```

It returns nothing useful, it looks things up in the directory, and it
may ask for approvals. That's the whole contract between the policy and
whatever runs it.

Hosts get their capabilities from Effect services:

<<< @/snippets/blog/in-the-beginning/12/language.ts#hosts

The dry run's directory knows that acme scores 80 and globex scores 40,
and that initech is unknown, which counts as the highest risk. Each
lookup waits a moment, as a real directory would, so the dry run runs
with `Effect.runPromise`. It returns the approvals the policy would
request:

```txt
security reviews acme
security reviews initech
```

An auditor's host might allow lookups but not approvals. The same policy
is rejected there before it does anything, and the error points at the
first rule that would ask:

```txt
error: unhandled effect: Approvals
2 |   (vendor acme 70 security)
  |   ^^^^^^^^^^^^^^^^^^^^^^^^^
```

A production host would provide a `Directory` that calls a real API and
an `Approvals` service that opens tickets. The policy, the language, and
the checker wouldn't change.

## Tools for free

Nothing in Parts 10 and 11 knows about vendors, and nothing needs to.
The documentation generator reads the new language and writes:

```md
### `(review (owner Name) (vendor Name))`

Ask owner to approve vendor.

### `(vendor (name Name) (limit Num) (owner Name))`

Have owner review name when its risk is over limit.

...

- `risk : (Data) -> Num ! {Directory}`
- `ask : (Data, Data) -> Unit ! {Approvals}`
```

Part 11's agent tools work on it unchanged, given the new prelude. An
agent that reads the policy gets the type `Unit ! {Approvals, Directory}`
in its report. If it tries to run `(vendor acme 70 security)` in the
REPL, the answer is `unhandled effect: Directory`, and nothing runs. The
REPL is a host too, and it was never given a directory.

## The Lisp Curse, revisited

The series started with a tension. Lisp makes it easy to invent
abstractions, and hard for other people and tools to understand them.
Here's where each part of the answer came from:

| Piece | From | What it gives a new abstraction |
| --- | --- | --- |
| Trees | Lisp, Parts 1 and 7 | Syntax that programs can read and write |
| Schemas | Effect Schema, Parts 2, 6, 10, and 12 | Shapes that tools can decode and check |
| Types | Parts 5 and 8 | A rule, checked where the abstraction is used |
| Effects | Effect, Parts 3, 4, and 9 | A statement of what running it will need |
| Forms | Parts 8 and 12 | Errors in the user's terms, at the user's code |
| Tools | Parts 10 and 11 | Docs, analysis, and edits that don't guess |

`vendor` is as cheap to invent as a macro: four lines of Lisp. Unlike a
macro, it comes with a rule the checker enforces, documentation a tool
can generate, and a type that tells a host what it needs. Other people,
and other programs, can understand it without reading its template.

## What it took

The whole system, everything the final post imports, from reader to
agent tools, is about 3,100 lines of TypeScript, not counting comments
and blank lines. Some of that is earlier parts' code that the last parts
no longer call.

The three ideas did most of the work. Part 2's reader is 67 lines,
because Lisp has no grammar to parse. Every representation (syntax, core, types,
diagnostics, reports, form declarations) got validation and JSON for free
from its schema. Concurrency, interruption, typed errors, and services
came from Effect: `race` is `Effect.race`, `catch` is `Effect.catchTag`,
and every capability is a service.

[Forma](/vision)'s engine is about 55,000 lines, roughly eighteen times
more. The difference is the engineering a teaching language skips:
modules and packages, more than one error per run, an editor and a
language server, good messages when inference fails, a faster
evaluator, records and strings and the rest of real syntax, and
emitting TypeScript that runs without the interpreter.

## Forma

This series is Forma's origin story. Here's the vendor example in Forma
itself, with records, keyword unions, options, and pattern matching:

<<< @/snippets/blog/in-the-beginning/12/vendor-types.lisp{lisp}

It type-checks as `Bool` and evaluates to `true`. Change `:risk :high` to
`:risk :medium` and the checker reports
`Expected Union<:low, :high>, found :medium`. Leave out the `None` case and
it warns `Non-exhaustive match: missing constructor(s) None`.

Forma's forms are declared in the language too, with typed holes, checks
whose diagnostics point at the author's source, and output whose shape is
a schema; see [Writing a form](/writing-a-form). The
[language guide](/language) and [roadmap](/roadmap) describe what Forma
does today, and what it doesn't yet.

## Where it ends up

Lisp gives us the freedom to invent languages. Schema gives those
languages form. Effect gives them consequences.

Together, they let us build languages that can explain themselves.

To try it, put Parts 2 through 11 in directories named `02` to `11`, this
post's files in `12`, install `effect` version 4, and run this with Node
24 from inside `12`:

```ts
import { Effect } from "effect";
import { typeOfPolicy } from "./language.ts";

const policy = "(vendor acme 70 security)";
console.log(Effect.runSync(typeOfPolicy(policy)));
// Unit ! {Approvals, Directory}
```

<p class="blog-source">The code in this post lives in
<a href="https://github.com/bjacobso/forma/tree/main/docs/snippets/blog/in-the-beginning/12"><code>docs/snippets/blog/in-the-beginning/12</code></a>
and runs in the site's test suite.</p>
