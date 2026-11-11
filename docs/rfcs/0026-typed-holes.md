# RFC 0026: Typed holes and bounded completion

| | |
| --- | --- |
| Status | Proposed; not implemented |
| Created | 2026-11-11 |
| Depends on | [RFC 0017](./0017-diagnostic-catalog.md) for structured diagnostics/fixes; [RFC 0004](./0004-one-analysis-architecture.md) for workspace parity |
| Scope | Incomplete expression goals, context inspection, bounded candidate search and source-versioned edits |

## Problem and current boundary

Forma's typed form “holes” are captured syntax slots, not unfinished terms.
`type/unified-form-provider.ts` extracts `(Expr T)` slots for checking;
`surface/form.ts` checks their types and injected scope. FX2 retains authored
syntax and named slot spans. None provides an Agda-style goal with a typing
context. This proposal adds that authoring facility, not a proof assistant.

## Proposed contract

In an explicit incomplete-analysis mode, recognize `?` and `?name` in expression
position as holes. Normal checking/building reports an error and emits no runnable
code or accepted artifact while holes remain. Do not treat a hole as `Dynamic`,
`Json`, an axiom, or an executable exception. Since these spellings can currently
be symbols, implementation must audit existing identifiers and document the
reservation or choose a non-conflicting syntax before enabling it by default.

An illustrative, not currently executable, editing session:

```lisp
(: greet (-> String String))
(define greet [name] ?body)
```

Return a proposed `typecheck/typed-hole` diagnostic containing:

- Source ID, revision/digest, authored range and a goal ID scoped to that revision.
- Expected type, or explicit unsolved metavariables when context cannot decide it.
- Allowed error/requirement sets when known; unknown is distinct from empty.
- Lexically visible bindings with instantiated schemes, declaration identities
  and origins, including form-injected scope. Never expose private imports.
- Bounded candidate expressions, obligations still outstanding, and atomic fixes
  following RFC 0017. Candidate lists are not “every possible program.”

Treat each occurrence as a separate goal, even when names repeat. Collect all
goals without allowing one hole's unknown type to suppress unrelated errors.
Freshen polymorphic candidates per use and check them against the actual local
context. A candidate must not introduce capabilities outside a known allowance.
When allowance is unknown, report its requirements and withhold a “checked fit”
claim. Scoped fields are available only in the expression where `:scope` binds
them, not elsewhere in the module.

## Staged search and clients

1. Expose expected type and context for annotated expressions, function bodies,
   record fields and `(Expr T)` slots. Reuse the authoritative checker for that
   dialect; do not force mechanics goals through HM as a shortcut.
2. Offer exact binding fits, record skeletons and exhaustive closed-constructor
   match skeletons. Skeletons may contain new goals and stay incomplete. Limit
   search depth, candidate count and checking time; report truncation.
3. Add bounded function/service application plans after their arguments and
   effect sets can be checked. Higher-order Effect suggestions depend on
   [effect-polymorphic signatures](./0023-effect-polymorphism.md), not on guessing
   closed sets. No service invocation occurs during search.
4. Share one structured result through embedded analysis and host tools, then LSP
   code actions. Recheck the changed document; stale/overlapping edits are refused.
   Cross-file goals wait for the actual module resolver and workspace invalidation
   of RFC 0004. Do not advertise complete LSP parity in advance.

Pattern holes and arbitrary declarative form slots are deferred: patterns bind
names and affect coverage, while `Type`, `Refers` and projected child slots have
different contracts. Ordinary descriptor completion remains available there.

## Validation and non-goals

Fixtures must distinguish local/shadowed/imported names; polymorphic candidates
used at two distinct types; injected scope inside versus outside a form; a fitting
success type with a forbidden requirement; known-empty versus unknown effects;
ambiguous versus annotated goals; two same-named holes; stale fixes; macro-origin
syntax that cannot be edited independently; and independent errors beside holes.
Assert that normal evaluation/generation refuses incomplete source and search
performs no host calls. Apply each “checked fit” edit and recheck independently.

No unbounded synthesis, dependent proof search, guarantee of a useful candidate,
or authorization to run a suggested service is included. Expected types guide
editing; they do not prove user intent or postconditions.
