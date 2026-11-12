---
date: 2026-11-07
title: The Reader Is the Bottleneck
description: An essay on why machine-written programs weaken the old case for macros and strengthen the case for languages whose abstractions come with rules a compiler can check.
---

# The Reader Is the Bottleneck

<p class="blog-meta">Essay · <time datetime="2026-11-07">November 7, 2026</time></p>

The case for macros has always been a case about writing. A macro lets
you say in one line what would otherwise take ten. Lisp programmers have
made a lot of this, and some have argued that how briefly a language lets
you say things is the best measure of its power.[1]

So here is a question that should bother anyone who likes Lisp. What
happens to that argument when writing is free?

It isn't hypothetical anymore. A coding agent will write the ten lines as
happily as the one, in seconds, without getting bored or making typos. If
the point of a macro was to save the writer effort, and the writer no
longer spends any, macros should matter less. Some people have concluded
exactly that.

I think that's half right. Machine-written code does weaken the case for
macros as a way to save keystrokes. But it strengthens a different case,
one that was always there and that mostly went unmade, because it wasn't
the one Lisp programmers were interested in.

When code is expensive to write, writing is the bottleneck. When code is
free to write, the bottleneck moves to the reader: whoever has to decide
whether the code is right. An agent can produce a thousand lines in a
minute. Someone still has to trust them, and trust is slow. You get it by
reading, by testing, and by running the thing somewhere safe and watching
what it does.

So the question to ask about a language feature changes. It used to be:
how much does this save the person writing? Now it's: how much does this
tell the person reading?

By that measure macros do badly. A macro tells the reader what the code
becomes. It doesn't tell them what they're allowed to write, or what the
result means. To understand a call to a macro you have to expand it in
your head, and when the call is wrong, the error usually shows up in the
expansion, in code nobody wrote.

The series this blog started with ran straight into this. Part 7 built
macros, and ended with a two-line one that applies a function twice. Give
it a function of two arguments, and the compiler correctly rejects the
program, but the error points inside the macro's template, at a call the
user never wrote.[2] The macro worked perfectly. It just had nothing to
say.

Now imagine the author is an agent. Agents are good at producing code
that looks right, and a macro is a place where code that looks right can
hide. The call is short and plausible, and the wrongness is somewhere
else.

A type is the opposite kind of abstraction. It's a claim about meaning
that the reader can rely on without reading the implementation, and the
compiler checks it everywhere the abstraction is used. When the same
`twice` became an ordinary function in Part 8, its type was inferred, and
the bad call was reported at the user's argument, in terms of what
`twice` expects.[3]

The difference wasn't power. The macro and the function did the same
thing. The difference is that one of them came with a rule.

That's the distinction that matters, I think, and it isn't really types
versus macros. It's abstractions that only rewrite versus abstractions
that bring a rule. Lisp's great idea was that you could add words to the
language. The missing half is that each new word should come with a rule
the compiler can check where the word is used.

You can have both. Part 12 declares new forms in the language itself, the
way you'd write a macro, except that each one states what its parts must
be. A mistake in a call is reported at the call, to its user. A mistake in
the form is reported in the form, to its author.[4] A form like that is
nearly as cheap to invent as a macro, and far more useful to read.

The strongest version of the argument comes from what agents actually get
wrong. They rarely produce programs that fail to run. They produce
programs that run and do the wrong thing.

Here's a small example. Ask for `x` to be renamed to `y` in
`(let ((x 2) (y 5)) (+ x y))`, do it as a text edit, and you get a program
that reads, type-checks, and runs, and returns 10 instead of 7.[5] Nothing
complains. The edit is plausible, and plausible is exactly the problem.

You can't fix this by making the author smarter, because the next author
will be a different one. You fix it by making the language narrower, so
that more wrong programs are rejected, and so that the ones it accepts
say what they'll do. A rename that's an operation on the program's
meaning, checked by the compiler, can refuse to make that edit. A text
edit can't.

The most useful thing a type says may not be about values at all. In
Part 9 the series' types started saying what a computation does: whether
it prints, whether it can fail, whether it waits. By Part 12 a vendor
policy has the type `Unit ! {Approvals, Directory}`, which means it looks
things up and may ask someone for an approval. A host that doesn't allow
approvals rejects the policy before it runs.[6] Someone operating that
host can read one line and know what an agent-written policy will do,
without reading the policy.

That's what I mean by the reader being the bottleneck. A line like that is
worth more than a hundred lines saved.

There are honest objections. Types don't make programs correct. They say
what kind of value comes back, not which one, and you still need
tests.[7] Owning a language is expensive, too. TypeScript has a type
checker, an editor, a package ecosystem, and millions of users, and a new
language starts with none of those. Anyone building a language now has
to justify that cost.

But the justification is different from what it used to be. It used to
be: you'll write less. Now it's: whatever gets written, by anyone or
anything, can be checked in the terms of the domain. For most code that
isn't worth a new language. For domains where the rules change often, are
written by people who aren't programmers, and have to be explained to an
auditor afterward, the language may be the cheapest place to put the
checks.[8] Compliance is one of those domains. There are others.

The old reason to build a language was so you could write less. The new
reason is so you can trust what was written. When writing is free,
knowing what was written is the scarce thing.

## Notes

[1] Paul Graham argues this in
[Succinctness is Power](https://paulgraham.com/power.html), and makes the
case for macros specifically in
[Beating the Averages](https://paulgraham.com/avg.html).

[2] [Part 7, *Macros Are Programs About Programs*](/blog/in-the-beginning/07-macros),
in its last section, "What macros can't say".

[3] [Part 8, *The Prelude Is the Language*](/blog/in-the-beginning/08-prelude-is-the-language).
The inferred type is `(('a) -> 'a, 'a) -> 'a`: a one-argument function and
a value. Nobody wrote it down. Macros aren't useless after this, though.
They're still the right tool for new *syntax*, which a function can't
provide.

[4] [Part 12, *A Language for Building Languages*](/blog/in-the-beginning/12-let-there-be-languages),
in "Two audiences, two places".

[5] [Part 11, *The Agent Can Read the Language*](/blog/in-the-beginning/11-agent-can-read-the-language).
The renamed program binds `y` twice, and the second binding hides the
first. Text edits fail a second way too: they rename quoted data that
only looks like code.

[6] [Part 9, *Effects Are Part of the Type*](/blog/in-the-beginning/09-effects-are-part-of-the-type)
adds effects to types. Part 12 builds the vendor policy language and the
host that rejects it.

[7] A type checker also rejects some programs that would have worked.
Part 5 of the series shows one. Narrower means narrower in both
directions.

[8] Some projects get part of this inside TypeScript, by building
programs as typed values. That keeps TypeScript's tooling, at the cost of
letting the host's type system decide what can be checked.
[Forma](/vision) is a bet on the other side: a language that owns its
type system, so each domain can bring its own rules. It's pre-alpha, and
the series' code is teaching code, not Forma's engine.
