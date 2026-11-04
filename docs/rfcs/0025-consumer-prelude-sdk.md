# RFC 0025: Generic parts of a consumer prelude, and sensitive values

| | |
| --- | --- |
| Status | Proposed; not implemented |
| Created | 2026-11-04 |
| Scope | A survey of worldvm's prelude support modules for roadmap item 5, with dispositions, and one proposal: a `Sensitive` type qualifier that limits what an expression may do with a value |
| Direction | Keep domain vocabulary in preludes; move into Forma only mechanisms that any typed domain language needs and cannot build from descriptors |

## Summary

worldvm's Forma prelude is supported by TypeScript modules that look
domain-neutral. This RFC reviews six of them against roadmap item 5, "a
supported consumer-prelude SDK", and gives each one a disposition. Three
belong to other RFCs, though their world-specific parts stay in worldvm.
One needs a small form option, and one needs only an example prelude. The
sixth, sensitivity, needs a language feature, which this RFC proposes:

```lisp
(type Ssn (Sensitive :pii String))
```

A value of type `(Sensitive c T)` can be compared for equality and tested
for membership. It cannot be ordered, used in arithmetic or aggregates,
formatted into a string, or passed where a plain `T` is expected. Revealing
one is an operation that requires a capability, so it appears in the
program's requirements.

## Survey

worldvm's `compileWorld` (`packages/forma/src/world/compile.ts`) runs a list
of diagnostic passes over lowered world IR after Forma elaboration. Six of
those modules were candidates:

| Module | What it does | Generic part | Disposition |
| --- | --- | --- | --- |
| `digest.ts` | Re-exports a pure SHA-256, canonical JSON, and a content digest that removes `at` spans | All of it | Covered by [RFC 0024](./0024-declaration-and-package-identity.md) |
| `documentation.ts` | Reports `E_MISSING_DOC` for any published declaration without a docstring, across about two dozen declaration kinds | The rule | A small form option, below |
| `citations.ts` | Warns when requirements, invariants, retention rules and decisions have no `:cites`; citations name a declared `source` and a clause | The source and clause mechanism | An example prelude, no engine change |
| `coverage.ts` | Maps each requirement to the scenarios and properties that reference it; warns about requirements no scenario covers | Which tests reference which declarations | A follow-up to [RFC 0015](./0015-tests-in-forma.md) |
| `scenarios.ts` | 865 lines that compile `given`, `do`, `at` and `expect` blocks into dated steps with typed expectations | Located expected/actual failures, prelude-defined test kinds | An amendment to RFC 0015, below |
| `sensitivity.ts` | Classifies types declared with `(Sensitive class T)` and rejects any sensitive type in a data slot | The qualifier | Proposed here |

### Documentation

A form that declares public names can require a docstring:

```lisp
(form (role name doc {:keys [...]})
  :types {:name (Declares Role) :doc (Option String) ...}
  :require-doc true
  ...)
```

The checker reports `form/missing-doc` at the declaration name when the
docstring is absent or blank. This replaces worldvm's list of about two dozen IR keys
with one option per form. [RFC 0011](./0011-signatures-as-contracts.md)
adds `:doc` to signatures; a module-level setting could later extend the
rule to exported functions.

### Citations

A citation is a reference to a declared `source` plus a clause string,
attached to a declaration and carrying its span. worldvm's prelude builds
this with a `source` form, `Refers` holes and `:check`. Forma's provenance
already keeps each declaration's span. The engine needs nothing new. The SDK
documentation should include a short citation prelude as a worked example
of cross-declaration metadata, using the fixtures of
[RFC 0023](./0023-reference-check-fixtures.md).

### Scenarios

worldvm's scenarios are a domain-specific, time-stepped test language. A
scenario runs commands against an account world and checks expectations
such as `(expect (status (PolicyReview change) window-signoff) :Open)` at
given instants. The selectors and the clock are world vocabulary.

Two parts are generic, and RFC 0015 should absorb them:

- **Prelude-defined test kinds.** RFC 0015's `test` is a kernel
  declaration whose body is an expression. A prelude should be able to
  declare another test form, such as `scenario`, whose IR a host-registered
  runner executes. Results then go through the same `runTests` operation,
  in the same structured form, with `test/assertion` diagnostics carrying
  expected and actual values at the expectation's span.
- **Typed syntax bodies.** worldvm's `scenario` form keeps its body as
  `(List Syntax)`, so `scenarios.ts` re-parses the source file with
  `@formalang/ts/reader` to find it again. worldvm's expression lowering
  (`packages/forma/src/world/lowering/context.ts`) does the same. A hole whose children are typed
  forms (`child ...`), or portable expressions
  ([RFC 0020](./0020-portable-expression-core.md)), removes the need. That
  depends on child forms working in file modules (RFC 0023, defect 3).

### Coverage

The generic part of `coverage.ts` is the question "which tests touch this
declaration?" Once RFC 0015's runner exists, `runTests` can report the
declarations each test referenced, statically from resolved references or
dynamically from evaluation. Mapping those to "requirements without a
scenario" is world vocabulary and stays in worldvm.

## Sensitive values

### Current state

- **worldvm.** `packages/forma/preludes/world/core.lisp` declares a
  transparent alias:

  ```lisp
  ; Classification remains in authored IR; value typing uses the underlying type.
  (type (Sensitive classification value) value)
  ```

  Forma's checker erases the classification, so it constrains nothing.
  worldvm recovers it after elaboration: `packages/ir-checks/src/sensitivity.ts`
  follows aliases and containers to classify a type, and
  `packages/forma/src/world/sensitivity.ts` checks source. The rule is a blanket ban:
  until vaults exist, no typed data slot may carry a sensitive value.
  Classes are fixed to `pii`, `financial`, `health` and `immigration`. There
  is no rule about operations, and no tracking through expressions.
- **Triplex.** The brief for this RFC describes in-progress work on
  sensitive attributes: equality goes through a keyed blind index, and
  range queries, ordering and aggregates are rejected. That work was not
  found on Triplex's main branch, in its pull requests, or in its branch
  names on 2026-11-04, so this RFC aligns with the description only.
- **Forma.** In the kernel's builtin schemes
  (`type/builtin-schemes.ts`), `=` is `forall a. a -> a -> Bool`; `<`, `<=`,
  `>` and `>=` take `Float`; `str` and `format` take any number of
  arguments of any type. The Effect checker already restricts `=` to
  primitives, enums and brands (`mechanics/equality` in
  `mechanics/check.ts`).

### Proposal

`(Sensitive c T)` is a type constructor in the kernel and Effect checkers.
`c` is a keyword naming a class. A prelude may restrict the classes with an
ordinary enum alias, such as `(type DataClass (Union :pii :financial :health))`,
which the checker uses when `Sensitive` is applied.

`(Sensitive c T)` does not unify with `T`. At run time a sensitive value is
represented as `T`. The qualifier exists only in types and in IR metadata.

What a program may do with a sensitive value:

| Operation | Allowed | Reason |
| --- | --- | --- |
| `=`, `!=` with another `(Sensitive c T)` | yes | A blind index can answer equality |
| `=` with a literal of type `T` | yes; the literal is coerced, as `Option` literals are coerced in records | Same |
| `contains?` against a list of literals | yes | Repeated equality |
| Store in a record field, list or `Option` declared with the qualifier | yes | The type records it |
| Pass to a parameter declared `(Sensitive c T)`, or a type variable | yes | The qualifier travels with the type variable |
| `<`, `<=`, `>`, `>=`, `min`, `max`, sorting | no | A blind index has no order |
| Arithmetic, `sum`, `product`, averages | no | Aggregates leak values |
| `count`, `exists`, `every` over a list of sensitive values | yes, when the predicate uses only equality | Counts members, not values |
| `str`, `format`, `concat`, substring and case operations | no | Formatting reveals the value |
| Pass where a plain `T` is expected | no | That would discard the qualifier |
| `(reveal x)` | only with the `Reveal` capability | Explicit, and visible in the requirement set |

Rejected operations report `sensitive/operation` at the operation's span,
naming the class and the operation, for example
`ordering is not available for (Sensitive :pii String)`.

`str` and `format` accept any argument today, so unification alone does not
reject them. The builtin table proposed in
[RFC 0019](./0019-everyday-checker-gaps.md) section 1 should record, for
each builtin, whether it accepts sensitive operands. That gives one place
to keep the rule for the kernel, the evaluator and the Effect checker.

`reveal` is the only way to remove the qualifier. It has type
`(-> (Sensitive c T) (Effect T [] [Reveal]))` in Effect programs. In kernel
programs it is a host builtin that a host grants explicitly, so
[RFC 0012](./0012-checked-evaluation.md)'s grant check rejects source that
uses it without permission.

### Where the qualifier goes

- **Schemas** ([RFC 0022](./0022-type-schema-generation.md)): JSON Schema
  gains `"x-forma-sensitive": "pii"`. Effect Schema gains an annotation with
  the same key, so a host can find sensitive fields without reading Forma
  types.
- **Portable expressions** ([RFC 0020](./0020-portable-expression-core.md)):
  a `fact` node carries `sensitive: c`. Only `eq`, `ne`, `in`, `known?`,
  `count`, `exists` and `every` with equality predicates accept such
  operands, so a host can evaluate them over blinded values. A
  Triplex-style store compares keyed blind-index tokens and never sees an
  ordering or aggregate request.
- **Artifacts**: a declaration's summary lists the sensitive fields it
  declares, by pointer, so a host can refuse to deploy a package that
  stores them in a slot without a vault.

worldvm's blanket ban becomes one host policy over these summaries,
rather than a separate source pass.

### Alternatives considered

- **A transparent alias plus a post-pass**, as worldvm does today. It
  cannot see what expressions do with the value, so it cannot allow
  equality and forbid ordering. It can only forbid everything.
- **Brands.** A brand also stops implicit use as `T`, but every brand would
  have to declare which operations it allows, and nothing would distinguish
  a sensitive brand from an ordinary one in schemas and artifacts.
- **Information-flow labels on every type.** A full lattice of labels would
  track flows through control decisions as well as data. That is a much
  larger change than the consumers need. The qualifier restricts
  operations on values, which is what a blind-index store can enforce.

### Conformance

Fixtures in `conformance/fixtures/typecheck` and
`conformance/effect-typescript`:

- equality, literal equality and `contains?` accepted;
- each rejected operation reported at its span, including `str`, `format`
  and arithmetic in a nested call;
- the qualifier preserved through `identity`, `map` and record field
  access, and rejected when passed to a plain `T`;
- `reveal` rejected without the capability and accepted with it;
- a class outside the prelude's enum rejected at the keyword;
- schema output carrying `x-forma-sensitive`.

## Implementation stages and validation

1. **Documentation option.** `:require-doc` and `form/missing-doc`. Small
   and independent.
2. **Sensitive qualifier in the kernel checker.** The type constructor,
   literal coercion, `sensitive/operation`, and the per-builtin rule. This
   uses RFC 0019's builtin registry if it lands first. Otherwise, the rule
   starts as a list in `builtin-schemes.ts`.
3. **`reveal`, the Effect checker and schema annotations.**
4. **RFC 0015 amendment.** Prelude-defined test kinds and declaration
   references in test results.
5. **Portable expressions.** The `sensitive` mark in RFC 0020's IR, once
   that RFC's stage 2 lands.

## Decisions still required

- Whether equality on sensitive values should itself need a capability,
  since a host must hold the blind-index key to answer it.
- Whether classes are open keywords restricted by a prelude enum
  (proposed) or a fixed list in the engine.
- Whether a record that contains a sensitive field is itself treated as
  sensitive for formatting, which would stop `(str record)` from leaking a
  field.
- Whether `count` over sensitive values should be allowed when the
  predicate compares them with each other rather than with literals, which
  reveals the number of distinct values.
