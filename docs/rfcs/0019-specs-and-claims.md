# RFC 0019: Specs and claims

| | |
| --- | --- |
| Status | Proposed; not implemented |
| Created | 2026-10-25 |
| Scope | `spec` modules, claims as signatures without definitions, `implements`, open claims, spec tests as laws, a per-claim verdict, spec integrity in the workbench |
| Direction | A person states what a module must provide in a spec; another author, often a model, writes the implementation; the checker reports which claims hold, which are open, and which fail |

## Summary

A spec module states claims: signatures whose definitions live elsewhere, and
tests over them.

```lisp
; pricing.spec.forma
(spec :for "./pricing.forma")

(: line-total (-> {:unit-cents Int :qty Int} Int))
(: order-total (-> (List {:unit-cents Int :qty Int}) Int))

(test "line total multiplies"
  (expect-equal (line-total {:unit-cents 250 :qty 2}) 500))
(test "an empty order is free"
  (expect-equal (order-total []) 0))
```

An implementation module declares that it implements the spec:

```lisp
; pricing.forma
(implements "./pricing.spec.forma")

(define line-total [{:unit-cents unit :qty qty}] (* unit qty))
```

Checking the implementation produces a verdict per claim:

```text
pricing.forma implements pricing.spec.forma (sha256:3f1c…)
  line-total    holds   1 test passed
  order-total   open    no definition
SOME CLAIMS OPEN
```

A claim holds when it has a definition that checks against the claimed type,
contains no holes, and passes every spec test that refers to it. The spec is
checked by itself, its tests see only the claims, and the verdict records the
hash of the spec it was checked against.

## Motivation

Bend separates intent from evidence. A person writes `LAWS.bend`; a model
writes `PROOF.bend`, which must import it. `bend PROOF.bend` prints
`SOME PROOFS FAIL` until every law has a valid proof, and refuses a proof file
that does not import the laws beside it. The model can write anything, but it
cannot change what counts as done.

Forma has no proofs, but it already writes signatures separately from
definitions, and its signatures carry more than a value type: the closed set of
failures and the capabilities an operation may use. A claim such as

```lisp
(: checkout
  (-> CheckoutRequest
      (Effect CheckoutResult [CheckoutRejected]
        [CartRepo.load Pricing.price Orders.create])))
```

says that `checkout` cannot fail in an undeclared way and cannot reach a
service outside the three named. With [RFC 0015](./0015-tests-in-forma.md)
tests, the spec can also pin behavior. Those are the obligations a reviewer
cares about most when a model writes the body.

What is missing is a place where the claims live apart from the code that
satisfies them, a rule that the implementation must address them, and a
result that says how far along it is. Today a signature without a definition
is a hard error with an unrelated code.

## Current state

- **Signature pairing.** `lowerProgram` (`packages/ts/src/type/lower.ts`)
  collects `(:` forms and attaches each to its `define`. A signature without a
  definition throws "Type signature for 'f' has no matching definition"
  without a code or span, so `diagnosticFromUnknown` reports it as
  `typecheck/type-mismatch`. Because lowering throws, the module is not checked
  any further. No fixture covers it.
- **Effect programs.** The single-file Effect pipeline reports
  `mechanics/top-level-form`, "The signature for X has no matching define or
  layer." (`mechanics/elaborate.ts`, pinned in
  `conformance/effect-typescript/cases/reject-stray-forms/`).
- **Signatures are not declarations.** `declarationKinds`
  (`modules/graph.ts`) lists `define`, `type`, `class`, `error`, `service`,
  `layer`, `macro`, `form`, and `typeclass`. Exporting a name that only has a
  signature reports `module/missing-export`.
- **No implementation relation between modules.** Module directives are
  `import`, `export`, and `export-from` (`modules/graph.ts`). Defining a name
  that is also imported reports `module/duplicate-import`. There are no
  signature-only modules, interface files, or abstract declarations.
- **The closest analogue is layers.** A `service` declares member signatures
  and a `layer` with `:provides` implements them. The mechanics checker
  reports `mechanics/missing-method`, `mechanics/unknown-method`, and
  `mechanics/undeclared-error` (`mechanics/check.ts`, pinned in
  `reject-layer-implementation`). The HM path does not check layer
  completeness.
- **Proposed neighbors.** [RFC 0011](./0011-signatures-as-contracts.md)
  adds `:doc` to signatures and derives JSON Schema for exports;
  it uses "contract" for an export's schema. [RFC 0013](./0013-runnable-host.md)
  proposes `forma check <entry>`. [RFC 0015](./0015-tests-in-forma.md)
  proposes `test` declarations and `runTests`. None of them is implemented.
- **Authorship.** Workbench proposals carry a `proposer` name
  (`packages/workbench/src/edits.ts`), and the model proposer is told that a
  person reviews every edit. Nothing records which forms a person wrote, and
  no check requires one file to import another.

## Proposal

### Spec modules

A module whose first form is `(spec)` or `(spec :for "./path.forma")` is a
spec module. In a spec module:

- A signature without a definition is a **claim**. Claims are not errors.
- Types, classes, errors, services, macros, forms, and helper definitions are
  allowed and exported as usual. A spec usually declares or imports the types
  its claims mention.
- `test` declarations may refer to claims. A spec checks by itself: tests
  are typed against the claimed signatures, without an implementation.
- `define` of a claimed name is rejected with `spec/defined-claim`. A spec
  states obligations; it does not discharge them.
- Importing a spec with `import` gives its exports but not its claims, which
  have no value.

`:for` names the module that must implement the spec. If that module does not
declare `implements` for this spec, checking either module reports
`spec/unimplemented`. This is Bend's guard: the person who wrote the spec
decides which file answers it, and deleting the `implements` line does not
make the obligation go away.

### Implementations

`(implements "./pricing.spec.forma")` is a module directive alongside
`import`. A module may implement more than one spec if their claim names do
not collide (`spec/claim-collision`). The directive:

- imports every export of the spec, as `import` with all names would;
- brings each claim's signature into scope, as if written in this module;
- exports each claimed name, so importers of the implementation do not need
  the spec.

Each claim's definition is checked against the claim exactly as a local
signature is checked today, including error and requirement sets in Effect
types. A local signature for a claimed name is allowed only if it is
identical (`spec/signature-conflict` otherwise). The implementation may define
and export other names; spec tests cannot see them.

### Open claims

A claim without a definition in the implementation reports `spec/open-claim`
at the implementation's `implements` directive, with the claim's span in the
spec in `details`. It is an error, so the module does not emit, but unlike the
current lowering error it does not stop the rest of the module from checking.

This RFC also replaces the current error for ordinary modules: a signature
without a definition reports `typecheck/missing-definition` at the
signature's span and checking continues.

A definition that contains a hole ([RFC 0018](./0018-typed-holes.md)) also
leaves its claim open.

### Verdicts

```ts
interface ClaimVerdict {
  readonly name: string;
  readonly status: "holds" | "open" | "fails";
  readonly reason?: "no-definition" | "hole" | "check" | "test";
  readonly tests: { readonly passed: number; readonly failed: number };
  readonly span: Span;                     // the claim in the spec
  readonly diagnostics: readonly Diagnostic[];
  readonly assumptions?: readonly TrustFact[];   // RFC 0020
}
interface SpecVerdict {
  readonly implementation: string;         // module id
  readonly spec: { readonly module: string; readonly sourceHash: string };
  readonly status: "holds" | "open" | "fails";
  readonly claims: readonly ClaimVerdict[];
}
```

- `holds`: defined, checks against the claim, contains no holes, and every
  spec test that refers to the claim passes.
- `open`: no definition, or the definition contains a hole.
- `fails`: the definition does not check, or a spec test that refers to it
  fails. A test that refers to several claims counts against each.
- A claim that no test mentions holds on its types alone. The rendering
  marks it `untested`.

The overall status is `fails` if any claim fails, `open` if any claim is open,
and `holds` otherwise. Spec tests run only after the implementation and spec
both check, each in its own evaluation, under RFC 0015's rules.

A host operation, `checkSpecs({ sessionId, entry })`, returns
`SpecVerdict[]` for the entry and its implemented specs. RFC 0013's
`forma check <entry>` prints the verdict when the entry implements a spec,
ending with `ALL CLAIMS HOLD`, `SOME CLAIMS OPEN`, or `SOME CLAIMS FAIL`. It
exits 0 only when every verdict holds. `--json` prints `SpecVerdict[]`.

### Spec integrity

The verdict records the spec's source hash, so a reviewer can tell which
statement of intent was checked. In the workbench:

- Spec modules are marked as specs in the outline.
- The model proposer's instructions say spec modules are read-only. A
  proposal that edits a spec module is shown with a separate "changes the
  spec" section, and accepting it requires a separate confirmation.
- The workbench shows the current verdict beside each claim.

Artifacts gain the implemented specs and their hashes in each module entry,
so a consumer of `ir.json` can see which claims the declarations satisfied.

## Alternatives considered

- **A `claim` declaration instead of a `(spec)` marker.** `(claim name type)`
  would not need a module marker, but it adds a second signature syntax.
  People already write `(:`; a spec is a module where `(:` may stand alone.
- **Signatures in the implementation module.** A person could write the
  signatures and a model the bodies in one file, but then the model can edit
  the signatures, and nothing separates the statement from the attempt.
- **Interface files, as in OCaml `.mli`.** An interface describes a module
  that already exists. A spec is written first and can include tests. The
  portable module interface remains the derived description.
- **Proofs.** Bend proves laws in a dependent type theory. Forma's claims
  stop at types, effect sets, and tests. Property checks over types as
  schemas are a natural extension (see [RFC 0015](./0015-tests-in-forma.md)).
- **Calling them contracts.** "Contract" already names form hole contracts,
  `Declares` contracts, payload contracts, and RFC 0011's binding contracts.

## Implementation stages and validation

1. **Missing definitions.** `typecheck/missing-definition` with a span,
   without aborting the module. Fixtures for a stray signature in a kernel
   module and in a file module.
2. **Specs and implementations.** The `spec` and `implements` directives,
   claims, claim checking, automatic exports, `spec/*` codes. Fixtures in
   `conformance/modules/` cover a holding implementation, an open claim, a
   wrong claimed type, an undeclared error in an Effect claim, a conflicting
   local signature, a claim collision, a `:for` target without `implements`,
   and an importer of the implementation that never sees the spec.
3. **Verdicts.** `checkSpecs`, spec tests over claims (depends on RFC 0015),
   and the `forma check` rendering (depends on RFC 0013), pinned by goldens
   of `SpecVerdict` and of the text rendering.
4. **Workbench.** Spec marking, the separate confirmation for spec edits, and
   verdicts beside claims, covered by workbench browser tests.

## Decisions still required

- Whether `spec/open-claim` should be a warning while editing, so that the
  rest of a module can be explored, with the verdict still reporting `open`.
- Whether a spec can claim layers (`(: layer Live :provides S)`) or only
  values and operations.
- Whether verdicts should be stored, like test outcomes, so a change that
  turns a holding claim into a failing one is visible in review.
- How `:for` should resolve once package specifiers exist
  ([RFC 0002](./0002-modules-and-packages.md)).

## Related designs

Bend's [guide](https://github.com/bendlang/bend/blob/main/guide/GUIDE.md)
states laws in `LAWS.bend`, proves them in `PROOF.bend`, reports laws without
proofs as open claims, and refuses a proof file that does not import the laws
beside it. OCaml's `.mli` files and Standard ML signatures separate a module's
interface from its implementation. Haskell Backpack lets a package depend on
a signature that another package implements.
