---
title: The Roots of Lisp — crib sheet
description: Independent Lisp study notes organized around the section headings of Paul Graham's The Roots of Lisp, with links to the original and a request for reproduction permission.
---

# The Roots of Lisp — crib sheet

An independent study aid alongside **Paul Graham’s
[The Roots of Lisp](https://paulgraham.com/rootsoflisp.html)**.
Read his essay for the argument, examples, and historical account.

::: info About this page
These are original notes inferred from the five section headings, not a
transcription, an authorized edition, or a section-by-section account of
Graham’s text. The explanations below are our own Lisp learning prompts;
they do not claim to reproduce his treatment. This is not a Forma adaptation,
and the vocabulary here is not a promise about Forma’s implementation.
:::

## A request to the author

Paul, may we publish a faithful Markdown edition of *The Roots of Lisp* here,
preserving your wording, examples, structure, and attribution, with a link to
your original and any conditions you specify?

That is a public request, not a claim that permission has been granted or
that we have contacted you directly. Until permission is obtained, this page
contains only independent notes. Your
[FAQ asks readers to link rather than mirror an essay](https://paulgraham.com/gfaq.html),
so the original remains on your site.

## 1. Seven Primitive Operators

**Study question:** What is the smallest vocabulary that lets us inspect
symbolic data, build new data, and choose what to evaluate?

| Operator | Mental model | Watch out for |
| --- | --- | --- |
| `quote` | Treat an expression as data. | Without quotation, a symbol or list can be interpreted as a program. |
| `atom` | Test whether a value is an atom rather than a nonempty list. | In Common Lisp, the empty list is also an atom. |
| `eq` | Compare symbol identity in these elementary examples. | Do not use it as a general test for structural list equality. |
| `car` | Select the first component of a pair. | Selecting a component is not evaluating it. |
| `cdr` | Select the remaining component of a pair. | For a proper nonempty list, this is its tail. |
| `cons` | Construct a pair from two values. | The result is a proper list only when the second value is a proper list. |
| `cond` | Choose the first branch whose test is true. | Only the selected result expression is evaluated. |

**Try explaining:** Why does a conditional need different evaluation rules
from an ordinary function that evaluates all its arguments first?

## 2. Denoting Functions

**Study question:** How do we describe a computation with inputs, then use it?

- A parameter gives an input a local name.
- A function body describes how to compute a result from those names.
- Applying a function connects argument values to its parameters.
- Recursion requires a way for a computation to refer to itself.

Keep three things separate: a function’s written representation, the values
passed to it, and the environment that supplies meanings for names. A modern
Lisp’s precise scoping rules are a separate question from how functions are
written down.

**Try explaining:** Which names belong to the call, and where would a name
not supplied by that call be looked up?

## 3. Some Functions

**Study question:** How much reusable machinery can grow from a small base?

A useful list-processing exercise has three parts: decide what the empty
input means, handle one element, and combine that step with the result for
the remaining input.

Practice with these independent exercises:

- Join two proper lists without changing their element order.
- Find a symbol in a list and report whether it occurs.
- Search a list of key–value bindings for a matching key.
- Transform each element of a list while preserving its shape.

**Check your reasoning:** Trace an empty input and a two-element input with
different elements. Identify which step reduces the remaining work and which
step constructs the result.

## 4. The Surprise

**Study question:** What changes when the data being processed is a program?

An evaluator connects an expression with an environment and computes a value.
It needs to distinguish data that should be returned unchanged, names that
need lookup, special evaluation rules, and function applications.

The key perspective is that an evaluator can itself be a program. When a
language can represent its own expressions as data, its own data-processing
tools can help describe evaluation. A self-interpreter still needs an
implementation to run it; writing one does not make the underlying machine
disappear.

**Try explaining:** At each step of evaluation, are you manipulating the
representation of an expression, or running the computation it represents?

## 5. Aftermath

**Study question:** What separates a small semantic model from a practical
programming system?

Use the model as a lens, not as a feature checklist. Real implementations
must make choices about numbers, memory, errors, environments, input/output,
and execution strategy. Sharing a family resemblance does not make Lisp
dialects interchangeable.

**Take away:** A small core can make a language easier to reason about, while
libraries and implementation choices determine how it feels to use. To learn
which historical conclusions Graham draws, return to the original essay.

## Sources and scope

- **Authoritative source:** Paul Graham,
  [*The Roots of Lisp*](https://paulgraham.com/rootsoflisp.html). His landing
  page is dated May 2001 and links the complete PostScript article and Lisp
  source code.
- **Heading reference:** The five numbered headings above follow the
  [existing third-party Markdown transcription](https://gist.github.com/cellularmitosis/f46e5d4d103da2d7577fd246ed737159).
  That transcription is not evidence of permission to republish the essay.
- **Publication preference:** Graham’s
  [General FAQ](https://paulgraham.com/gfaq.html).

Only the numbered section titles are retained from the essay’s outline.
The prose, table, and exercises on this page are newly written; no original
essay prose or code has been reproduced. They are a companion for study,
not a replacement for the source.
