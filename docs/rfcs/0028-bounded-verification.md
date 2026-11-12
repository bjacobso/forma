# RFC 0028: Finite workflow laws before solver-backed verification

| | |
| --- | --- |
| Status | Proposed experiment; not implemented |
| Created | 2026-11-11 |
| Related | [RFC 0022: programmable type system](./0022-programmable-type-system.md), [RFC 0015](./0015-tests-in-forma.md), [RFC 0012](./0012-checked-evaluation.md) |
| Scope | Finite workflow/evidence safety laws, counterexamples and a later restricted solver profile |

## Motivation and existing limits

Literal refinements, schema validation and match exhaustiveness are not general
theorem proving. Main has no solver profile, proof holes or independent trusted
core checker. The proposed `forma/refined` profile in RFC 0022 is not implemented.
The [research recommendation](https://ampcode.com/threads/T-01a1c7ed-621e-7456-b6a5-baebae21aa73)
is to validate domain laws with finite exploration before investing in SMT,
Lean export, general affine typing or dependent types.

## First experiment: a small model, explicit laws

Use an ordinary prelude to describe finite state, transitions and safety laws,
emitting typed IR to a bounded explorer. Do not add workflow-specific HM rules
or a new execution kernel. Restrict transition predicates to a documented pure,
decidable expression subset; reject arbitrary hooks/native calls in the model.
Report which elaboration/checking components are trusted until RFC 0022 exists.

Start with two workers, two policy identities and two fact revisions. Transitions
are `evaluate`, `invalidate`, `retry` and `release`. Evidence records issuer,
worker, policy and revision. The central invariant is: every successful release
has authorized evidence for the same worker/policy at the current revision.
Freshness is equality of explicit revision identities, not an unbounded clock.

Explore reachable states to a fixed point, including worker interleavings.
Canonicalize states, retain predecessor edges, and return a shortest trace
linked to authored transitions on failure. A report contains model/source hashes,
initial states, domains, transition semantics version, assumptions, state/edge
counts, explored bounds and result. Distinguish:

- **Counterexample:** a reachable violating state, with a concrete trace.
- **Holds in this finite model:** fixed-point exploration completed.
- **Inconclusive:** time/state/depth budget exhausted or an operation unsupported.

A depth-bounded prefix without a fixed point cannot claim the second result.
Vacuous laws and unreachable release transitions must be reported explicitly.

## Controls and acceptance

Remove the freshness guard and recover `evaluate v1 → invalidate to v2 → retry
→ release with v1`. Swap worker and policy independently to expose mismatches;
test unauthorized issuance separately. Restore each guard and explore to a fixed
point with no violations within the declared domains. Report counts rather than
hardcoding expected counts before the model exists. If authorization is consumable,
add a separate law rejecting reuse; evidence need not itself be one-use.

Compare model traces to independently expected results and an executable adapter
on the supported subset. This is conformance evidence, not proof of interpreter
agreement. Production needs trusted issuance, atomic freshness-check/commit,
idempotency and retry semantics, as specified at runtime boundaries in RFCs
0012/0016. Static brands authenticate neither the issuer nor freshness.

## Later stage: restricted solver profile

Only after the finite experiment demonstrates a consumer, propose a precise
`forma/refined` fragment: finite enums/sets and bounded integer intervals first,
then selected arithmetic predicates. Specify Int overflow versus mathematical
integer semantics, and reject Float/regex/recursion or native predicates until
their meanings and solver encodings are defined. Preserve HM as the default.

Potential obligations include rule overlap/coverage and arithmetic pre/postconditions.
Translate counterexamples back to authored values and revalidate them in the
source semantics. Treat timeout or `unknown` as inconclusive, never success.
Choose explicitly between trusting a pinned solver/translation and checking
certificates in an independent verifier. An `unsat` response is not a kernel
proof without that trust account. Lean export is a separate possible backend,
not an automatic guarantee about the executing program.

## Non-goals and ordering

No claims about arbitrary workflows, infinite-state liveness, exactly-once external
effects, fairness without modeled assumptions, or unrestricted dependent proofs.
Implement the finite experiment first; consider scoped one-use capabilities only
for a concrete domain, then narrow solver refinements. General usage checking
through aliases, closures and host calls needs core rules, not branded records.
Keep general affine/dependent profiles deferred until these cheaper mechanisms
fail a demonstrated requirement.
