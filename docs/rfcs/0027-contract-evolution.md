# RFC 0027: Directional contract diffs and checked migrations

| | |
| --- | --- |
| Status | Proposed; not implemented |
| Created | 2026-11-11 |
| Related | [RFC 0011](./0011-signatures-as-contracts.md), [RFC 0020](./0020-packages.md), [RFC 0007](./0007-type-normalization.md) |
| Scope | Comparable contract snapshots, directional compatibility reports and explicit pure payload migrations |

## Current evidence, not a compatibility proof

`artifact/contract-identity.ts` computes `irContractId` from an IR root name
and canonical reachable type definitions, including metadata. `payloadContractId`
identifies that contract; it is not a semantic subtyping test, a function's
behavior hash, a migration, or an interpreter version. Renaming an alias or
changing documentation can change identity without changing accepted wire data.
Keep the present hash algorithm and artifacts unchanged in the first slice.

## Proposal

Compare two explicitly supplied, validated snapshots. A snapshot records source
revision, contract ID, resolved type graph, codec/version and supported profile.
Report structural changes by stable declaration identity or an explicit rename
map, never by similar spelling alone. Missing graphs or unsupported refinements
produce `unknown`, not compatible. A future `forma diff` may resolve Git refs to
these inputs, but no such command is implemented by this RFC.

Compatibility is directional and role-specific:

| Change | Question to answer |
| --- | --- |
| Request field required/removed | Can the new server decode every request from the old client? Does its decoder reject unknown fields? |
| Response optionality/union member | Can the old client decode every response from the new server? |
| Numeric/string refinement | Is the producer's accepted value set included in the consumer's, under the actual codec? |
| Error-set expansion | Must the caller handle a newly observable failure? |
| Requirement-set expansion | Must the host grant new authority? |

Do not collapse all five into record width subtyping. Specify unknown-field,
absence/null/Option, tag, number-range and wire-encoding rules per codec. Error
and requirement diffs need exported operation signatures in addition to payload
graphs; do not infer them from `payloadContractId`. Metadata-only changes should
be identified separately even when the content ID changes.

Begin with concrete finite data shapes and exact literal/interval inclusion.
Recursive types require a terminating pairwise graph comparison. Unsupported
regex implication, generic row constraints or opaque native codecs remain
unknown; RFCs 0006/0007 own generic normalization rather than a parallel reducer.

## Migrations and gates

A proposed migration is a checked pure function from the old decoded type to
the new type, identified by both snapshots and a migration implementation hash.
Checking the arrow does not prove preservation of business meaning, reversibility,
totality or termination. Require authored field values/defaults for additions;
never invent data for required fields or silently discard fields as “safe.”
Automatically suggest only unambiguous structural adapters, and require review.

A bidirectional lens additionally needs explicit laws for round trips and a
policy for information loss. It is not the default migration representation.
Stored payloads, RPC traffic and workflow continuations have different version
policies: workflow state needs pinned runtime/handler semantics under
[RFC 0016](./0016-host-call-journals.md), not merely a converted payload.
This RFC does not run database writes or update production artifacts.

## Stages and acceptance

1. Read-only snapshots and reports: compatible, incompatible or unknown per
   direction, with paths, old/new spans and assumptions. Cover reordered fields,
   metadata changes, renames, recursion, narrowed intervals, added tags, optional
   versus nullable fields, both unknown-field policies, and unsupported codecs.
2. Pure authored migration checking, with independent before/after fixtures,
   invalid output rejection and explicit information-loss reports. An inverse
   must pass both round-trip laws over the declared supported domain.
3. Optional CI policy requiring reviewed migrations or waivers for selected
   breaking contracts. Unknown must not pass a compatibility gate silently.
   A waiver names the consumer and assumptions; it is not proof.

Generated schemas and native RPC/HTTP consumers must decode the same fixture
bytes used by the report. No “proof-carrying schema evolution” claim is warranted
without a defined compatibility calculus and evidence connecting it to codecs.
