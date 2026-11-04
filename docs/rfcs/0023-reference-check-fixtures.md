# RFC 0023: Reference-check conformance fixtures

| | |
| --- | --- |
| Status | Proposed; not implemented |
| Created | 2026-11-04 |
| Measures | [RFC 0008](./0008-typed-form-results.md) and [RFC 0019](./0019-everyday-checker-gaps.md) |
| Scope | A minimal fact-and-flow fixture prelude, one diagnostic fixture per class of cross-declaration authoring mistake, parity between editor and emit and between preludes and file modules, and the fixes the fixtures exposed |
| Direction | Pin the authoring mistakes a typed domain language must catch as stored diagnostics, and track how many need hand-written checks |

## Summary

onb-next relies on `tsc` to reject authoring mistakes in its TypeScript DSL
before anything runs. This RFC ports the classes of mistake it covers to
Forma as diagnostic fixtures: a small fixture prelude, and one case per class
with its expected code and the authored token it points at.

The fixtures are a measure. On main today, Forma reports every one of the
eleven classes, but only one comes from the language itself. The other ten
need hand-written `:check` hooks that read other declarations through
`declaration-hole`. Writing them also exposed five defects, listed below.
Each later language change, such as RFC 0008's typed reflection, is
measured by how many fixtures move from a hand-written check to a
declarative contract, with the same diagnostics.

## The classes in onb-next

There are 66 `@ts-expect-error` cases in three files, not 69 (a raw grep
also counts one header-comment line in each):

| File | Cases |
| --- | --- |
| `packages/dsl/test/type-errors.ts` | 48 |
| `packages/library/uscis-i9/test/type-errors.ts` | 14 |
| `demo/acme/test/type-errors.ts` | 4 |

All are checked by `tsc`; none is executed. Classified:

| Class | Cases | What the check needs |
| --- | --- | --- |
| a. Field bound to an attribute that does not exist | 3 | The declared attribute names of a type |
| b. Field or path of the wrong value type | 4 | The referenced attribute's value type |
| c. An option the enum lacks | 10 | The declared values of the referenced attribute or condition |
| d. A concept bound to the wrong type | 3 | The concept's value type |
| e. A task whose assignee does not sign as the form's signer | 5 | The form's signer set |
| f. An edge from a port the decision's condition lacks, or a decision edge without a port | 3 | The condition's values, through the decision |
| g. An awaited subprocess without a port, or with a port the child lacks | 5 | The child process's outcome states |
| h. A node over another subject | 7 | The enclosing declaration's subject and each node's subject |
| i. An end outcome outside the declared states | 1 | The enclosing process's states |
| j. A value-map target not in the external schema | 1 | The schema's field names |
| k. Duplicate ids in a form | 0 | Uniqueness across children |
| Other: a string where a declaration is required | 8 | The reference's declaration kind |
| Other: names missing from a generated catalog, path hops, constants and widgets of the wrong type, edge shapes, action parameters, subprocess inputs | 16 | Reflection on another declaration's fields or types |

Class k is not a `tsc` check. `Form.define` and `Process.define` throw on a
duplicate id when the package is built. Class e is only partly a type check:
the type proves the signer is one of the form's signers, and a builder
throws if the assignee does not sign as that signer.

Most classes need the same thing: a fact declared by **another
declaration** (its options, states, value type, fields or subject),
compared with a value written here. onb-next gets that by carrying
declared literals in generic type parameters, with `NoInfer` and branded
handles.

## Current state

Forma has two built-in reference checks and one general mechanism:

- **`Declares` and `Refers` holes.** A reference must resolve, and to a
  declaration of the right kind. Diagnostics point at the reference:
  `elaborate/hole-type: Unknown reference nickname`, and
  `g is FormDecl, expected Attribute`.
- **`:check` with reflection.** A check is a Forma function that receives
  the holes and returns diagnostics. It can read another declaration's
  authored holes with `(declaration-hole name :hole)`. A diagnostic can
  point at a hole (`:slot`) or at a path inside one (`:at`)
  ([Writing a form](../writing-a-form.md)).

RFC 0008 proposes typed reflection (`:reflect`) and checked result
templates (`FieldsOf`, `SelectionKeys`). RFC 0019 is about the kernel and
Effect checkers agreeing; it does not cover cross-declaration checks.

## Probe

The fixture prelude below declares concepts, attributes, conditions, forms
with fields, processes with child nodes, external schemas and value maps.
It is about 130 lines. Every rule is written as `:check` over
`declaration-hole`. An excerpt:

```lisp
(form (field id control attribute {:keys [when]})
  :types {:id String :control (Union "date" "text" "select")
          :attribute (Refers Attribute) :when (Option String)}
  :ir FieldIR
  :check (fn [{:keys [control attribute when]}]
    (concat
      (if (= (declaration-hole attribute :value-type) (control-type control)) []
        [(err "facts/field-type" :attribute "The attribute's value type does not fit this control.")])
      (if (or (= when nil) (contains? (or (declaration-hole attribute :options) []) when)) []
        [(err "facts/unknown-option" :when "The attribute has no such option.")])))
  {:kind "Field" :id id :control control :attribute attribute :when when})

(define ports-of [n]
  (cond
    (= (get n :kind) "Decision")
      (or (declaration-hole (declaration-hole (get n :condition) :attr) :options) ["yes" "no"])
    (= (get n :kind) "Subprocess") (or (declaration-hole (get n :process) :states) [])
    :else nil))
```

Results at commit `a62797e`. Each case was loaded after a shared base of
valid declarations, through the host's `emit` and `analyzeEditor`, which
agreed in every case:

| Class | Caught by | Diagnostic points at |
| --- | --- | --- |
| a. missing attribute | `Refers` | the name |
| b. wrong value type | `:check`, one reflection | the reference |
| c. unknown option | `:check`, one reflection | the option literal |
| d. concept type | `:check`, one reflection | the concept reference |
| e. unknown signer | `:check`, one reflection | the signer literal |
| f. unknown or missing decision port | `:check` over siblings, two reflections | the whole parent process |
| g. awaited subprocess port | `:check` over siblings, one reflection | the whole parent process |
| h. other subject | `:check` over children, one reflection | the whole parent form |
| i. end outcome | `:check` over children | the whole parent process |
| j. value-map target | `:check`, one reflection | the target literal |
| k. duplicate id | `:check` over children | the whole parent form |
| string where a declaration is required | `Refers` | the name |

Every class is caught; onb-next does not catch k before building. Four
classes point at the whole parent rather than the offending child. An
author can fix that with an `:at` path such as `[:node 2 :port]`, which
the probe confirmed reports the `"maybe"` literal, but must compute the
child's index by hand.

## Defects found

1. **Cascading diagnostics.** When a `Refers` hole does not resolve, the
   form's `:check` still runs. `declaration-hole` returns `nil`, so the
   check reports a second, misleading error at the same token
   (`facts/field-type` after `Unknown reference nickname`).
2. **Engine payload validators match consumer kinds.**
   `artifact/domain-payloads.ts` registers validators for IR kinds named
   `Entity`, `Process`, `Query`, `Record`, `View`, `Document`, `Action` and
   others, for every prelude. The fixture prelude's own
   `{:kind "Process" ...}`, checked against its own `:ir` type, failed
   `emit` with `artifact/workflow-payload: Process payload $.trigger:
   Missing key`. Ontology vocabulary is applied to a consumer that never
   loaded the ontology prelude. This contradicts the rule that domain
   vocabulary belongs in preludes.
3. **Repeated child forms fail in file modules.** A form with a
   `child ...` pattern works when loaded as a prelude. In a file module it
   fails with `module/compile-time-data: Unbound symbol: item__forma_…`
   when defined and used in one file, and with `internal/error: Unknown
   compile-time binding item__forma_…` when imported. A minimal two-form
   reproduction is enough. Flat forms work across modules, including a
   reflection check: a value map in one module was checked against an
   external schema declared in another.
4. **The editor and `emit` report hook failures differently.** When a
   `:check` hook fails to evaluate (here, an unbound symbol), `emit`
   reports `elaborate/validation-failed` in `diagnostics`. `analyzeEditor`
   reports `typecheck/descriptor-check`, and only in its separate `errors`
   list; its `diagnostics` list is empty. In that list, `code` holds the
   form's source text and the diagnostic code is in `diagnosticCode`. A
   client that reads only `diagnostics` shows nothing.
5. **Reflection is untyped.** `declaration-hole` returns authored data.
   Reading a hole the declaration's form does not have returns `nil`
   rather than an error. A misspelled hole name in a check silently
   disables the check.

Defects 1 to 4 can be fixed before any of the proposals below. Each needs
a small decision, recorded under [Decisions](#decisions-still-required),
but none needs new language design. Defect 2 matters most for roadmap item
5, because any consumer prelude may choose these kind names.

## Proposal

### Fixtures

Add `conformance/reference-checks/`:

- `prelude.lisp`: the fixture prelude, written with `:check` hooks today;
- `cases/<class>-<name>.forma`: one mistake each, plus `valid.forma`, which
  must produce no diagnostics;
- `expected.json`: for each case, the diagnostics as `{ code, severity,
  text }`, where `text` is the authored token the span covers, as in
  `conformance/descriptor-metacheck/cases.json`, and `mechanism`: `language`,
  `check`, or `declarative`.

The runner loads each case in four ways and requires the same diagnostic
codes and spans from all of them, reading both `diagnostics` and `errors`
from editor analysis:

1. as a prelude-backed source, through `emit`;
2. through `analyzeEditor`;
3. as a file module that imports the fixture library;
4. as a file module whose referenced declarations live in another module.

Ways 3 and 4 fail today because of defect 3. They are recorded as expected
failures until it is fixed.

The fixtures also require that each diagnostic points at the authored
child or literal, not at the parent form. Today's four parent-level cases
are fixed in the fixture prelude with `:at` paths.

### The measure

`expected.json`'s `mechanism` field gives the measure. Today, of the
eleven classes, 1 is `language` and 10 are `check`. The extra case of a
string where a declaration is required is also `language`. Each proposal below moves cases to
`declarative`, with the same codes and spans:

| Class | Today | RFC 0008 | Needs something new |
| --- | --- | --- | --- |
| a | language | | |
| b | check | typed reflection gives the attribute's declared type | a constraint on a reference hole |
| c | check | | a hole whose values come from another declaration |
| d | check | typed reflection | a constraint on a reference hole |
| e | check | | a hole whose values come from another declaration |
| f | check | | the same, through a sibling child |
| g | check | | the same, through a sibling child |
| h | check | | declaration kinds indexed by a subject |
| i | check | | a hole whose values come from a sibling hole |
| j | check | `SelectionKeys` over a reflected schema | |
| k | check | | unique keys for repeated children |

RFC 0008 helps with three classes (b, d and j), and only once its
reflection reaches beyond record fields to a declaration's holes. It fully
covers only j. For b and d it supplies the reflected type, but a
declarative constraint on the reference hole is still new. RFC 0019 covers none
of the eleven. Its refinement-literal stage (E5) applies to one of the
other onb-next classes, a constant of the wrong value type.

The largest gap is one new feature: **holes whose permitted values are
declared elsewhere**. Classes c, e, f, g and i are all "this literal must be
one of the values that declaration (or that sibling) declares." A sketch:

```lisp
:types {:attribute (Refers Attribute)
        :when (Option (OneOf attribute :options))}
```

`OneOf` reads a list-valued hole of the referenced declaration, checks the
literal against it, and gives the editor a completion list. onb-next
authors get that completion from `tsc` today. The design belongs with
RFC 0008's slot adapters, and is left to a follow-up.

## Alternatives considered

- **Port all 66 cases.** Most are variations of the same class over
  different vocabulary. One case per class, plus the ones that point at a
  child, measures the same thing with a prelude a reader can follow.
- **Generate TypeScript builders and rely on `tsc`.** `generateFormBuilders`
  can type `Refers` holes in generated builders. That serves TypeScript
  authors only, and Forma authors would still get no diagnostic.
- **Wait for RFC 0008.** The fixtures are useful now. They found five
  defects, and they pin today's behaviour so that RFC 0008 is checked
  against it.

## Implementation stages and validation

1. Fix defects 1, 2 and 4. For defect 2, scope engine payload validators to
   the prelude that defines the kind, or drop them where the prelude's own
   `:ir` contract already checks the payload.
2. Add the fixture prelude, the cases, and the prelude and editor runners.
3. Fix defect 3, then enable the file-module runners.
4. Design `OneOf`, sibling references, unique child keys and subject-indexed
   kinds as amendments to RFC 0008, each moving fixtures to `declarative`.

## Decisions still required

- Whether engine payload validators remain at all for prelude-defined
  kinds, or move into the ontology prelude as ordinary `:ir` contracts.
- Whether `declaration-hole` should error on a hole the declaration's form
  does not declare.
- Whether a `:check` should be skipped when one of the holes it reads
  failed to resolve (proposed), or receive an explicit unresolved marker.
- Whether the fixtures should also run in the Foldworks workbench, which
  consumes the same editor analysis.
