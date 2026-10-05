# Language

Forma uses Lisp syntax with lists, vectors, maps, symbols, keywords, strings,
numbers, booleans, quote, quasiquote, and comments. The reader preserves source
identity and spans for formatters, editors, and diagnostics.

## Core execution

The core includes lexical bindings, functions, conditionals, pattern matching,
collection operations, macros, and records. Programs can run through a direct
evaluator or the TypeScript bytecode VM. Evaluation is bounded by an explicit
step limit in embedded hosts.

## Types

Inference is Hindley–Milner style with records and language-defined descriptor
hooks. Operational computations use `Effect<A, E, R>`:

- `A` is the success value.
- `E` is a closed set of typed failure variants.
- `R` is a closed set of required operations or capabilities.

Calls, failure construction, and recovery remain explicit in typed core and in
portable artifacts. This preserves useful effect information without making
runtime continuation handling part of every backend contract.

[Effect programs](./effect.md) describes how schemas, errors, services,
operations, and layers written in Forma are checked and generated as Effect
TypeScript.

## Elaboration

Consumers define forms and meta functions in preludes. Descriptors specify
their slots, bindings, validation, result types, construction hooks, and
completion metadata. Elaboration turns matching source forms into typed domain
IR while retaining provenance.

The compiler therefore stays open to new domain languages while the engine
remains closed over its core vocabulary.

## Portable conformance

The shared fixtures deliberately use the intersection implemented by both
engines. They cover evaluation, unification and folds, typed authority, and
operational effects. A fixture that differs between engines is a language
parity defect.
