---
title: In the Beginning Was the Schema
description: A twelve-part build-in-public series on building a typed Lisp from first principles with Effect TypeScript. Lisp makes programs into data. Schema makes data meaningful. Effect makes meaning executable.
---

# In the Beginning Was the Schema

<p class="blog-subtitle">Building a typed Lisp from first principles with Effect TypeScript.</p>

> Lisp makes programs into data. Schema makes data meaningful. Effect makes
> meaning executable.

This is a twelve-part series written as the work happens. It starts with a
tiny Lisp interpreter and ends with a typed, extensible language powered by
[Effect](https://effect.website) and Schema.

The goal isn't just to show how to build a Lisp. It's to show why Lisp's
simplicity, Schema's structural descriptions, and Effect's compositional
runtime fit together unusually well. Three ideas come out one at a time:

- **Lisp gives us syntax as data.** Programs are trees that programs can
  inspect, generate, and transform.
- **Schema gives us structure with meaning.** Those trees can have validated
  shapes, decoded representations, transformations, and typed
  interpretations.
- **Effect gives us semantics as composable programs.** Evaluation, errors,
  environments, dependencies, concurrency, and execution can be modeled
  explicitly.

## The tension: the Lisp Curse

Lisp makes it easy to invent abstractions. It doesn't make it easy for other
people, or other tools, to understand them. Every team that leans on macros
ends up with a dialect that only its authors can read, check, or refactor.

The bet of this series is that typed elaboration, a disciplined core
language, and Schema-backed representations can keep Lisp's extensibility
while making its abstractions inspectable and checkable. You don't have to
buy into a new language to follow along. You build one, and you find out
why each piece is needed when the previous version breaks.

## Act I · Genesis

Give the language form, meaning, and an environment.

### 01 · [In the Beginning Was the List](./01-the-list)

Build the smallest Lisp imaginable: numbers, symbols, lists, and an
evaluator. Explain why code-as-data matters more than parentheses.

`(+ 1 2)` → `3`

### 02 · [And the List Became Schema](./02-list-became-schema)

Represent the language's abstract syntax with recursive Effect Schema
definitions. Introduce parsing, validation, and structured diagnostics.

*A program is data with a shape.*

### 03 · [Errors Are Not Exceptions](./03-errors-are-not-exceptions)

Implement evaluation as `Effect<Value, EvalError, Environment>`. Show how
explicit failure changes interpreter design.

*A language runtime should know how it can fail.*

### 04 · [The Environment Is Not the World](./04-environment-is-not-the-world)

Introduce lexical scope, closures, and Effect services. Distinguish a Lisp's
lexical environment from the host interpreter's dependency environment.

*Names resolve in scopes. Capabilities resolve through services.*

## Act II · Logos

Give the language types, interpretation, and the ability to extend itself.

### 05 · [Types Before Execution](./05-types-before-execution)

Build a type-checking judgment, inference for simple expressions, function
types, and type errors. Use Schema to represent and validate type structures.

`(+ 1 "hello")` → a type error before evaluation

### 06 · [The Interpreter Becomes a Compiler](./06-interpreter-becomes-compiler)

Introduce elaboration: surface syntax becomes a small, typed core language.
Make type-checking and execution separate phases.

*Syntax is what you write. Core is what it means.*

### 07 · Macros Are Programs About Programs <Badge type="info" text="Coming" />

Implement quotation, quasiquotation, and hygienic syntax transformation.
Explain why Lisp's homoiconicity is useful but not enough on its own.

*The compiler can be extended in its own language.*

### 08 · The Prelude Is the Language <Badge type="info" text="Coming" />

Build `if`, `let`, `when`, `match`, and domain-specific constructs through
typed elaborators instead of growing the compiler.

*A small kernel, many languages.*

## Act III · Praxis

Give the language capabilities, execution, and real-world applications.

### 09 · Effects Are Part of the Type <Badge type="info" text="Coming" />

Add effectful computations and distinguish pure values from operations that
require capabilities. Model typed errors, asynchronous operations, and
resource requirements.

*The type describes not only the result, but what the computation demands.*

### 10 · One Program, Many Interpretations <Badge type="info" text="Coming" />

Build an evaluator, formatter, analyzer, and documentation generator over
shared typed representations. Schema enables structural inspection; Effect
enables composable interpretations.

*Programs become things we can reason about, not just execute.*

### 11 · The Agent Can Read the Language <Badge type="info" text="Coming" />

Expose typed syntax, compiler diagnostics, structured edits, and a REPL to
coding agents. Compare free-form text editing with AST-aware
transformations.

*The agent doesn't have to guess what the program means.*

### 12 · Let There Be Languages <Badge type="info" text="Coming" />

Build a small domain-specific language with the typed Lisp, its prelude, and
Effect-backed capabilities. Show a real application, not an interpreter demo.

*The final product isn't a Lisp. It's a language-building platform.*

## The architecture that emerges

<div class="blog-stack" role="img" aria-label="Four layers from Surface Lisp through Effect Schema and Typed Elaboration to the Effect Runtime, used by a REPL, a compiler, and agents.">
<div class="blog-stack__layer"><b>Surface Lisp</b><span>S-expressions · quotations · macros · DSL syntax</span></div>
<div class="blog-stack__layer"><b>Effect Schema</b><span>Syntax trees · types · validation · transformations</span></div>
<div class="blog-stack__layer"><b>Typed Elaboration</b><span>Name resolution · inference · macros · typed core</span></div>
<div class="blog-stack__layer"><b>Effect Runtime</b><span>Evaluation · services · errors · concurrency · resources</span></div>
<div class="blog-stack__clients"><span>REPL</span><span>Compiler</span><span>Agents</span></div>
</div>

<p class="blog-caption">A conceptual architecture. Effect Schema describes representations; the language's own type checker still has to establish typing judgments and soundness.</p>

## How this relates to Forma

This series is the origin story of [Forma](/vision), the pre-alpha
programmable type system for Lisp that this site documents. Readers discover
why Forma is shaped the way it is by building a smaller language themselves.

The series code is teaching code, written from scratch in each part. It is
not Forma's engine and doesn't track its APIs. Every snippet in a published
part lives in the repository and is run by the site's tests, so the code you
read is code that works. Forma itself is described by the
[language guide](/language) and [roadmap](/roadmap); where a part describes
something Forma doesn't do yet, it says so.
