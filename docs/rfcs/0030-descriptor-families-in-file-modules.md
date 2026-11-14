# RFC 0030: Descriptor families in file modules

| | |
| --- | --- |
| Status | Accepted; implementation incomplete (see implementation gate) |
| Created | 2026-11-13 |
| Related | [RFC 0002](./0002-modules-and-packages.md), [RFC 0008](./0008-typed-form-results.md), [RFC 0021](./0021-languages-as-libraries.md) |
| Scope | Qualified declarations, nested references and descriptor-aware child dispatch in file modules |

## Motivation and boundary

A descriptor family that works as a project prelude should work unchanged as
an imported `.lisp` library. A plain file already exports simple `form`
definitions, retaining private helper closures and type metadata. Three gaps
prevent a family from doing the same: qualified declaration names are rejected,
nested `Refers` reaches value-contract validation, and linked child calls are
evaluated as expressions before their descriptors are selected.

The evidence is commit `87b8356` on `wp/lx2-data-adapter`, specifically
`conformance/libraries/connectors/README.md` and
`packages/ts/test/connectors-import-investigation.test.ts`. Its four probes
record limitations, not intended semantics. This RFC designs LX2a only; the
output-neutral adapter/backend split and data emission belong to LX2b. No
adapter API or new bundled library is proposed by this RFC.

## Current execution: gap 3

In `packages/ts/src/surface/form.ts`, `parseUnifiedForm` records hole types,
family types, helpers and hooks. `unifiedFormHooks` matches a call with
`matchFormSyntax` and first converts every hole to a value. For an unlinked
project prelude this is `datum(e)`, so a child call remains syntax-shaped data
rather than executing its head.

A later loop recognizes optional/repeated child holes, obtains candidates from
`FormDescriptorRegistry.getChildForms` in
`packages/ts/src/descriptor/FormDescriptorRegistry.ts`, and dispatches them.
That query follows family aliases/unions to IR member types. The loop first
tries the direct head descriptor, then `${childName}/${childHead}` for a family.
It normalizes the child, recursively invokes `unifiedFormHooks`, validates it,
constructs its IR and rebinds the parent's hole to that IR. `:scope` can extend
the child's semantic environment; child errors retain the child's location.

The linked path in `packages/ts/src/modules/compile-time.ts` is different.
`discoverFormDeclarations` discovers names introduced by imported forms;
`prepareCompileTimeModule` retains form ownership and its `read` function builds
hooks with a `LinkedFormContext`. Its `evaluateHole` callback chooses
`isSyntaxHole(type) ? datum(hole) : run(hole)`. The syntax classifier recognizes
several syntax categories and lists, but not a child-family type. Thus the
first conversion executes `(step ...)` as ordinary code before the later
child loop can dispatch it. This produces an unbound head error even when the
family has a `family/step` descriptor.

Two further differences matter: module bindings have resolved identities,
not merely concatenated family/head strings, and the recursive
`unifiedFormHooks(childDescriptor, ...)` call omits the linked context. Fixing
only the initial evaluation order would leave child hooks without their
definition-site module environment.

## Proposed execution contract

### Resolve the family, then select the child

A linked form carries its defining module and binding identity. Resolve its
hole types in that definition scope, including aliases, optional wrappers and
lists. A child hole denotes either one descriptor or a family of descriptors
whose produced IR belongs to the family's resolved IR members. Preserve those
resolved type and descriptor identities; identical spellings in two modules
are different families. Re-exports retain the original identities.

Build the family's child lookup from those allowed descriptor identities and
their authored names in the family's definition scope. The existing
`family/child` spelling supplies the local child label; it is resolved there
once, never reconstructed from a mangled importer-visible symbol. Descriptors
available through the defining module's imports keep their original owner.
Private descriptors reachable from an exported parent are retained as
implementation dependencies, not added to the importer's ordinary bindings.

For each present hole, before `evaluateHole` can run ordinary code:

1. Classify it using the resolved hole type. Preserve child syntax and recurse
   through optional/repeated containers; absence stays absence.
2. For a child call, resolve a direct head binding to a descriptor identity
   when available. If it is an allowed descriptor, select it. Otherwise use
   the family's local child-label lookup, preserving today's direct-then-family
   precedence. An ordinary value binding does not block that lookup.
3. Verify family membership by resolved identity. A missing or disallowed child
   reports `elaborate/hole-type` at the authored head, naming the expected family
   and allowed authored child names. Do not fall back to evaluating that call.
4. Normalize, validate and construct the selected child, then bind its IR into
   the parent hole before running the parent's `:check` or `:ir` body. A child
   error prevents parent hooks from consuming an invalid projection.

Ordinary value holes continue using caller evaluation; syntax/reference holes
continue preserving syntax. Probe tests on the pre-change linked engine establish a narrower boundary:
a single family hole already accepts a prebuilt IR map, including a symbol
bound to that map. Keep those values on the existing evaluation/contract path.
A `let`-bound helper result and a helper call returning child IR fail child
dispatch today; repeated holes reject all three computed-child probes. Only
call-shaped children in those paths require child syntax rather than an
expression computing IR. This introduces no macro expansion
or evaluation of the child head. Parent hook dependency ordering must use
projected child values; a preliminary frame may retain raw syntax for existing
`:scope` behavior, but must never execute a child call as a conversion shortcut.

### Shadowing, imports and nesting

Inside a family hole, `(step ...)` selects that family's child even if the
caller has an ordinary function or value named `step`. Outside that hole the
ordinary binding retains its usual meaning. An explicitly resolved descriptor
head takes priority only when it belongs to the allowed family, matching the
existing prelude rule. Neither a same-spelled unrelated descriptor nor a value
can silently replace the family's child.

Importing the parent is sufficient: `(import "./flow.lisp" [flow])` enables
its private child vocabulary only inside its typed holes. The importer need
not import or receive an export of `flow-child/step`. An independent top-level
use still requires an ordinary visible form binding. Explicitly importing an
exported child remains possible; it does not change the parent's family.

Nested families repeat the same algorithm using each selected child's hole
types and definition scope. The innermost expected family controls an
unqualified child label; the outer family does not leak into it. Two libraries
may both define `flow-child/step` without interference, including when their
parents are imported under namespace aliases or re-exported through a facade.

### Hook environment and source ownership

Recursive child execution receives the linked context of the selected
descriptor's owner, not a copy of the parent's owner and not an unlinked
fallback. Its `:check`, `:ir`, result-type and `:scope` hooks use that owner's
environment and runner. Prepare dependencies for every invoked hook, including
private constants and transitive helper dependencies, through the owner's
existing lazy reads; preparing only the parent's IR body is insufficient.

Use a fresh hole frame over the owner's environment. Helper closures and
imports resolve at their definition site; ordinary expressions within the
child's own value holes evaluate at the caller site. Semantic declarations and
`:scope` bindings come from the authored call's semantic environment. These
two environments have distinct jobs: private helpers are accessible to hooks
without becoming callable bindings in the importing source.

Preserve original syntax/provenance through dispatch. Hook diagnostic codes
and `:at` paths retain their meaning, including paths into nested children.
Fallback diagnostics locate the authored child call. Messages show authored
names; source ID and line/column belong in spans, never appended to messages.

## Qualified module declarations: gap 1

Allow slash-qualified local declaration names such as `flow-child/step` and
private helper `flow/check` for the existing declaration kinds. Slash-separated
segments must be nonempty; dots and reserved internal names remain forbidden
with `module/declaration-name`. This is a local binding spelling, not a module
namespace declaration. Defining it grants no access to another module.

Resolve an exact local or named-import binding before interpreting a slash as
namespace access. Otherwise `alias/name` continues to mean an export of the
aliased module; `alias/flow-child/step` can address an explicitly exported
qualified binding. Exporting `flow-child/step` exports that exact binding;
exporting the parent does not implicitly export it.

No ambiguity is resolved by declaration order. Two declarations with the exact
name `flow-child/step` (a child and an ordinary exported binding, for example)
fail with existing `module/duplicate-declaration` at the duplicate declaration.
A conflicting named import retains `module/duplicate-import`. A namespace alias
`flow-child` and local or named-import `flow-child/step` cannot coexist, whether
or not the aliased module exports `step`: report `module/duplicate-import` at
the conflicting import/alias and identify both names. Thus a child cannot
silently capture `flow-child/step` that would otherwise access a module export.
Export aliases must likewise remain unique under the existing export checks.

Local declarations shadow builtins today: `(define map [x] (+ x 1))`
changes a local `(map 41)` to `42`. Qualified locals follow that same rule:
`diag/error` shadows the exact builtin, while `diag/custom` is an ordinary
local even though its prefix names a builtin namespace. A prefix alone does
not grant namespace access. Rewriting the exact local to its resolved identity
keeps it separate from builtin calls in imported library helpers. Those helpers
retain their defining environment; caller shadowing must not capture them.

## Nested semantic references: gap 2

In `unifiedFormHooks` validation, walk hole syntax and its resolved type
together through `Option`, `List`, record fields and type aliases. Check
container shape and ordinary leaves with the existing value rules; preserve
syntax and location at every `Refers Kind` leaf. An absent optional value
requires no reference check. Each present leaf must name a declared target of
the named resolved kind in the call's semantic scope. Declaration discovery
must precede this pass so forward references keep working.

Run the semantic check before hooks consume the validated hole. Use
`elaborate/unknown-reference` for an unresolved target and
`elaborate/reference-type` for a declared target of the wrong kind, located at
the leaf. A non-symbol leaf gets a located `elaborate/hole-type` diagnostic.
Retain existing unlinked diagnostic codes for already-supported prelude cases.
An ordinary binding of a compatible value type is not a declared target.

Do not add a permissive `Refers` case to `contractErrors`: value contracts
cannot establish declaration existence, kind identity or semantic scope. A
mixed record must still validate its ordinary fields as well as its references;
skipping an entire composite contract because it contains syntax is unsound.

## Hook-only helpers are compile-time code

This section proposes option 1 for phase 4; it is not implemented or accepted
yet. Checked Forma keeps strict `Bool` conditions and no truthiness. Prelude
helpers execute in the dynamic compile-time dialect. File modules need an
explicit boundary between these phases rather than unsound builtin HM schemes.

### Classification and checking

A top-level `define` is hook-only when reachable from a form hook and unreachable
from every runtime root. Hook roots include `:check`, the `:ir` construction body,
`:type`/result-type computation, `:scope`, `:emit` and `:infer-fn`, including their
named-hook equivalents. Traverse lexical dependencies transitively through
helper functions and constants, including helpers retained by private children.
Literal type metadata and quoted names do not constitute helper calls.

Runtime roots are every exported value (including export aliases and facade
re-exports), top-level runtime expressions and definitions required by those
expressions. Every `define` outside the hook-reachable set is also a runtime
root, including an otherwise unused private definition. A reference from any
runtime `define` makes its dependency runtime, transitively. Follow references
inside function bodies as well as initializer expressions; taking a helper as
a value counts as use. A definition reached by both phases stays HM-checked.
Compute both closures to a fixed point, so cycles cannot hide a runtime use.
Exporting a form descriptor alone does not make its hook dependencies runtime;
exporting a helper value does.

Unreachable definitions remain ordinary checked definitions. This is no general
unchecked-private-function facility. Shared helpers must satisfy ordinary HM:
a non-`Bool` condition reports `typecheck/type-mismatch` at the condition; a
builtin lacking an HM scheme still reports `typecheck/unbound-symbol` at its
use. No new truthiness coercion or permissive `Unknown` scheme is introduced.

Reuse the checks behind `forma prelude check` (#155), in
`preludes/check.ts`, for the compile-time portion with its resolved dependencies:
reader/declaration and descriptor validation; hook/reference, hook-kind and
projection metachecks (`validatePreludeMetacheck`); nonempty form docstrings;
at least one example per form and elaboration of every example; registration
of literal diagnostic codes and codes emitted by examples in the consumer
catalog. Docstrings and examples are obligations of forms, not each helper.
Reuse this service over module syntax and environments, not by concatenating
files into a prelude that loses lexical identities. Apply it during module
checking, so CLI and editor checking agree without a second command.

The prelude path offers no exhaustive static arity or unbound-symbol check over
helper bodies. Bootstrap, example execution and invoked hooks retain evaluator
checks for unbound symbols and argument counts wherever the evaluator enforces
them. An unexecuted branch can therefore contain an undetected error. Hook-only
helpers lose HM inference, generalization, argument/result compatibility and
static `Bool` condition checks; descriptor contracts still check hook results.
Passing examples demonstrate those executions, not soundness of every branch.

Reader, descriptor and documentation errors point to the defining source;
example failures identify the form's example and retain its source mapping.
Helper evaluation failures point to the authored helper expression when known,
with a related invoking hook/call span; otherwise locate the hook application.
Preserve explicit hook diagnostics and their `:at` locations. Spans carry source
ID and line/column; messages contain authored names, never mangled identities.

### Visibility and editor behavior

Hook-only helpers remain private lexical dependencies of their descriptors.
An importer naming one in its import list gets `module/private-export`
at that import, just as for any other private binding. Importing
the parent neither exports the helper nor grants an ordinary callable binding.

Recommend that an explicit export makes the helper runtime and HM-checked,
rather than rejecting the export itself. Exporting is an unambiguous request
for an ordinary API, and the same runtime-root rule handles direct exports,
aliases and re-exports. A dynamic helper may then fail HM at its defining body;
the export does not bypass checking or synthesize an inferred public scheme.

Hover labels a hook-only binding “compile-time helper (prelude dialect)” and
shows its authored parameters, documentation and definition location. It shows
no inferred HM type; annotations may be shown as authored, not HM-verified.
References and go-to-definition retain lexical identities. Shared/exported
helpers show normal HM types and diagnostics. The language server publishes
the same metacheck, example and evaluation diagnostics as module checking,
including on unused branches only when an existing prelude check detects them.

### Implementation sketch and acceptance tests

Extend `modules/compile-time.ts` to expose hook roots and lexical dependency
edges already used by `prepareCompileTimeModule` and LX1's dependency graph.
Use resolved binding identities across modules, respecting parameters, local
bindings, quotes and executable unquotes; the existing symbol collector alone
is not a scope-aware classifier. Include definition-site imports and private
child hooks. Keep the current lazy helper execution environment.

In `modules/check.ts`, compute hook/runtime closures before lowering and invoking
`inferProgram`, the HM entry in `type/infer-program.ts`. Exclude only hook-only
definitions from that file-module HM input, and run the shared prelude checks
with source mappings. Do not insert helper schemes into the runtime environment.
Expose classification to editor metadata/signatures so absence of an HM type
is deliberate. Keep the ordinary HM engine's strict conditions unchanged.

Add neutral conformance fixtures for each hook root and a transitive helper
chain; runtime initializer/body use, exports, alias/facade exports, shared use,
unused definitions and cycles; private import rejection and lexical shadowing;
metacheck, documentation, example, diagnostic-coverage and executed arity/name
errors. Pin located HM rejection of a shared helper's truthy condition and the
limited checking of unexecuted helper branches. Add editor hover/type/diagnostic
tests and cross-module identity tests. Finally require all three connectors
probes to pass with the unchanged library, plain CLI check to accept the passing
source, and `bad-state` to retain both located `E_MACHINE_STATE` diagnostics.
These are future implementation gates; phase 4 changes documentation only.

## Compatibility and rollout

Forma is greenfield: this RFC does not promise that nothing newly errors, and
adds no compatibility shim. Conformance cases pin qualified-name resolution and
collisions, nested reference validity and locations, family identity/dispatch,
private hook environments, and the proposed compile-time/runtime boundary.
The new form documentation/example checks can reject incomplete file-module
libraries; exporting or sharing a dynamic helper subjects it to HM checking.

The pre-change computed-child probes are executable compatibility evidence in
`file-module-families.test.ts`: single prebuilt maps and their bound symbols
pass; single `let`/helper calls and repeated computed entries fail. These pinned
successful paths remain requirements; broader historical behavior is not a
compatibility contract.

Project and bundled preludes retain datum-first conversion, direct-descriptor
precedence, scopes, projections and existing diagnostic codes. Resolved family
metadata adapts their current registry behavior without imposing file-export
restrictions. `forma:kernel`, `forma:test`, `forma:effect/*` and existing
conformance programs keep their pinned import selection and results. No global
child registry is added. Review semantic expectation changes explicitly;
do not silently rewrite stored output to make an implementation pass.

## Test plan for phase 2

Write failing tests before implementation, with neutral conformance cases:

| Case | Required assertions |
| --- | --- |
| Gap 1: imported workflow family | Unchanged `flow-child/step` and `flow/check` declarations work; only `flow` is exported/imported; explicit qualified exports and alias access also work. |
| Gap 2: catalog references | `Option (List (Refers ItemDef))` and references in nested records accept declared/forward targets; missing targets, wrong kinds, ordinary bindings and malformed leaves fail at the leaf; ordinary sibling fields still validate. |
| Gap 3: nested layout families | Private child `:check` and `:ir` helpers run in their defining modules; caller value holes and `:scope` work; ordinary `step` shadowing, two same-spelled libraries, alias/re-export imports, nested families and disallowed heads follow the dispatch rules. |
| Collision: qualified child and export | Duplicate child/ordinary exported binding fails deterministically; alias `flow-child` exporting `step` versus local `flow-child/step` fails in both import orders; noncolliding aliases still resolve. |

Then restore the `87b8356` connectors fixture and convert its three expected
failure probes to success assertions using the unchanged library, removing the
in-memory renaming and omitted-hole workarounds. Keep the simple-form probe.
Assert elaborated nested IR, reference rejection and located child hook errors,
including preserved `E_MACHINE_STATE`; plain CLI checking must agree. Exact
emitted JSON and graph parity remain LX2b gates, not claims of this phase.

Run targeted module/form tests, existing prelude and Effect-import tests,
conformance and surfaces without rewriting expected outputs, then `pnpm check`.
Phase 2 adds the minor changeset after the release; this design-only phase has
no changeset. RFCs are repository-only (`docs/.vitepress/config.ts` excludes
`rfcs/**`); there is no RFC index to update.

## Alternatives considered

**Rename children to unqualified names.** Flattening avoids the naming gate
but loses family-local vocabulary and creates collisions between libraries.
It also changes the existing library instead of demonstrating import parity;
the owner's scope decision explicitly rejects that shortcut. Weakening nested
references to `Symbol` would similarly discard the semantic guarantee.

**Treat child holes as macros.** Expansion could rewrite heads before ordinary
evaluation, but it would need the same resolved family membership and ownership
information, while duplicating descriptor validation, IR projection and source
tracking in another execution path. Children already have typed descriptors;
dispatching them directly preserves that contract without introducing macro
visibility or expansion semantics.

**Require every child to be imported.** This exposes private implementation
vocabulary and makes a parent library's internals part of every call site's
imports. Retaining reachable descriptors by identity gives lexical execution
without granting the importer ordinary access to private bindings.

**Typed truthiness (option 2).** Give `some` an `Option` result and permit `if`
to consume `Option`. The phase-4 recommendation rejects this because it reverses
the strict-`Bool`, no-truthiness design documented in `docs/clojure.md`, and
typing `some` alone does not settle other dynamic helper idioms. Greenfield
makes compatibility cost moot; it does not remove that language-design change.

**Edit the library (option 3).** Rewrite helpers with explicit predicates and
HM-supported operations. The recommendation rejects this because the task is
to import the unchanged prelude-style library; rewriting it evades the phase
boundary and leaves other dynamic prelude helpers facing the same question.

## Implementation gate (phase 3 evidence; phase 4 decision pending)

The three engine paths have an initial implementation with neutral regression
fixtures, but acceptance remains blocked. The unchanged connectors library now
checks its `name-of` helper using the new polymorphic `nil?: a -> Bool` scheme.
The next missing builtin is `some`. Its runtime implementation in
`builtins/collections.ts` returns the first truthy callback result, or nil when
no result matches (including an empty input). Consequently even a Bool callback
does not justify the proposed `(a -> Bool) -> List a -> Bool` scheme. A sound
nullable result cannot feed the unchanged library's Bool-only `if` conditions.
Changing runtime behavior or the condition-checking boundary needs a separate
decision; neither is introduced here. Regression tests pin this evidence.

`same?` is the library's private definition, not a builtin. `keyword?` already
has a polymorphic predicate scheme and `keyword/name` already returns String.
Literal-key `get` calls lower to core `Get`; `infer-record.ts` infers an open
record for an unconstrained receiver and uses its existing record/Map/Unknown
rules. No new ordinary `get` scheme is required for these calls. `flat-map`
already has authority analysis alongside `map`, but its ordinary HM scheme
remains deferred at the stop gate.

Phase 4 proposes the hook-only boundary above to address this gate; Meta and
Ben have not chosen it yet. The final status “Accepted; implemented in this PR”
must wait for that decision, implementation and the remaining test plan to
pass. No stored expected output has been rewritten.
