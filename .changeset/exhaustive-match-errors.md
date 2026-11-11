---
"@forma-language/forma": patch
---

Reject matches missing constructors of a closed tagged type in the kernel
typechecker, matching the Effect checker's existing error behavior. Cover every
constructor or add a final `_` arm. Duplicate-constructor and unreachable-arm
diagnostics remain warnings.

RFC 0019 stage-2 audit: the existing programs that change from warning to error
are the three typecheck fixtures `match-non-exhaustive-warning`,
`match-let-bound-non-exhaustive-warning`, and
`match-let-alias-chain-non-exhaustive-warning` in `conformance/fixtures/typecheck`.
Their historical fixture IDs are retained; their expectations now require an
error and unsuccessful checking. Diagnostic messages, source spans, and inferred
types are unchanged.

The conformance suites, bundled-prelude checks, and example artifact corpus
(58 sources, 548 declarations) pass without program repairs. No surface golden
changes are needed (249 comparisons pass).
