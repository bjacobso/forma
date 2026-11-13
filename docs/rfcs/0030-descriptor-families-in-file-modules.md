# RFC 0030: Descriptor families in file modules

| | |
| --- | --- |
| Status | Proposed; design only, not implemented |
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
engine change, adapter API or new bundled library is delivered by this note.

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
continue preserving syntax. A child hole accepts child syntax, not an expression
that computes a child or a prebuilt IR value. This introduces no macro expansion
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

## Compatibility and rollout

No previously working program should newly error or change meaning. The naming
collision rules require newly legal qualified local/imported bindings; existing
namespace-only uses retain their meaning. Duplicate declarations/imports are
already errors. The new reference rejection cases occupy file-family/nested
record paths that currently fail before successful validation; implementation
must pin that boundary rather than tighten unrelated binding-type fallbacks.

Project and bundled preludes retain datum-first conversion, direct-descriptor
precedence, scopes, projections and existing diagnostic codes. Resolved family
metadata adapts their current registry behavior without imposing file-export
restrictions. `forma:kernel`, `forma:test`, `forma:effect/*` and existing
conformance programs keep their import selection and results. No global child
registry is added. Any counterexample to this compatibility claim blocks phase
2 acceptance and requires a revised design, not a silent breaking adjustment.

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
