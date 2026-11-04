# RFC 0020: A portable runtime expression core

| | |
| --- | --- |
| Status | Proposed; not implemented |
| Created | 2026-11-04 |
| Depends on | [RFC 0022](./0022-type-schema-generation.md) for the generated schema; [RFC 0019](./0019-everyday-checker-gaps.md) section 2 for numeric inference in expression holes |
| Scope | A typed, total, deterministic expression IR for `(Expr T)` holes, three-valued logic, decimals, dates, calendars, a TypeScript evaluator, shared conformance fixtures, host fact binding |
| Direction | Forma checks a restricted expression once and emits typed data that every host evaluates the same way; consumer conventions are prelude lowerings, not evaluator options |

## Summary

A form hole written `(Expr Bool :portable true)` accepts only expressions in
a small core language. Forma checks the expression against the hole's scope
and emits it as a typed tree, with source spans beside it, instead of
today's untyped S-expression JSON. A new package, `@formalang/expr`, contains the tree's
schema, a TypeScript evaluator, and fixtures. Any other evaluator, such as a
SQL compiler or an evaluator in another language, must pass the same
fixtures.

The core uses Kleene three-valued logic for facts that are not yet known.
Unknown is distinct from `Option`. The numeric types are `Int` and an exact
`Decimal`; `Float` is not portable. Dates are calendar dates. Calendars are
data that the host supplies. A well-typed expression over well-typed inputs
always produces a value, `unknown`, or one outcome from a closed error list.
It never throws.

## Motivation

Both consumers built a typed domain language with condition and value
expressions, and both wrote their own evaluators:

- **onb-next** has a value graph with node kinds `source`, `target`,
  `compare`, `all`, `any`, `every`, `is_set`, `coalesce`, `choose`, `lookup`,
  `collect`, `concat`, `format_date`, `add_business_days`, `sum` and
  `product`. It also has named bool and enum conditions, and `Where` filter
  trees with `eq`, `ne`, `lt`, `lte`, `gt`, `gte`, `in`, `contains`,
  `is_set`, `count`, `exists` and `every`. These are evaluated by four
  implementations that disagree:
  - the flow kernel (`packages/flow-kernel/src/values.ts`, `compile.ts`);
  - a compliance rule evaluator (`packages/compliance-kernel/src/facts.ts`);
  - a two-valued plan explainer (`packages/runtime/src/inclusion.ts`);
  - a SQL compiler for views (`packages/views/src/compile.ts`).

  Examples of the disagreements: the flow kernel's `every` is unknown when
  an item is unknown, but the SQL compiler treats that item as false. The
  flow kernel's `is_set` is never unknown, while its `choose` takes the
  `else` branch on unknown, as SQL `CASE` does.
- **worldvm** checks requirement conditions in a Forma prelude, but does not
  evaluate Forma's emitted expressions. `packages/forma/src/world/lowering/context.ts` re-parses the
  source text and lowers it to its own `IR.Expr`, which
  `reconciler/src/evaluation.ts` evaluates. Its `if` returns Unknown when
  the condition is Unknown. Its equality compares `String(a) === String(b)`,
  so `1 = "1"` is true. Its evaluator throws on an unbound name or an
  invalid date. A second, smaller evaluator over Forma's `raw-expr` JSON
  lives in the prelude (`pred/eval` in `packages/forma/preludes/world/interactions.lisp`).
  It runs at publish time.

The two consumers disagree on almost every edge case:

| Case | onb-next flow kernel | worldvm |
| --- | --- | --- |
| Representation of unknown | `null`; unset and unknown are the same thing | tagged `Unknown{why}`, separate from `null` |
| Condition unknown in `if`/`choose` | takes `else` | Unknown |
| Equality | strict deep equality | `String()` equality |
| Ordering | numbers, or strings by code unit (dates as strings) | numeric only; dates through `before?` |
| Business days, negative count | steps backwards | no-op |
| Holidays | none (weekends only) | declared, versioned calendars |
| Invalid date `2026-02-30` | normalised to March 2 | rejected |
| Totality | total at run time; errors at compile time | throws |

Neither consumer has decimals; both use IEEE doubles. Neither has division.

## Current state

- **Checking.** A form hole typed `(Expr T)` is checked where it is written.
  `:scope` supplies the names and types it may use (`surface/form.ts`,
  [Writing a form](../writing-a-form.md)). An enum alias keeps its members,
  so `(= status "actve")` against `Status` is an error.
- **Emission.** `descriptor/runtime-expr.ts` lowers the authored syntax to
  canonical values. Lists become arrays, symbols become strings, and string
  literals become marker maps:

  ```ts
  export const RUNTIME_STRING_LITERAL_KEY = "$forma.runtimeExpr";
  export const RUNTIME_STRING_LITERAL_KIND = "string-literal";
  ```

  A probe on main with
  `:types {:when (Expr Bool)}` and
  `:scope {:when (fn [holes] {:age (quote Int) :status (quote Status) ...})}`
  emits:

  ```json
  {"kind":"raw-expr","expr":["and",[">=","age",18],
    ["=","status",{"$forma.runtimeExpr":"string-literal","value":"active"}], ...]}
  ```

  The emitted tree does not say which strings are operators and which are
  scope variables, what type the expression or any subexpression has, or
  where each node came from. It also does not say which builtins the host
  must implement. The checked type is discarded.
- **Protocol types.** `preludes/canonical-runtime-protocol.lisp` describes
  this payload as `CanonicalExpr`, a union of `Unit`, `Bool`, `Float`,
  `String`, lists and maps. It has no `Int`.
- **No evaluator.** Nothing in the repository evaluates `raw-expr`. The
  kernel evaluator runs Forma programs; it does not evaluate emitted
  expression payloads.
- **Numbers.** `Int` and `Float` are the only numeric types
  ([design decisions](../design-decisions.md#distinct-int-and-float-values)).
  Unannotated arithmetic infers `Float`
  ([RFC 0019](./0019-everyday-checker-gaps.md), K9 to K11). There is no
  decimal type, no `Date` type in the kernel, and no calendar.

## Proposal

### The core language

The IR is a tagged JSON tree. Every node carries its static type. Spans are
not part of the tree: they go in the provenance sidecar of
[RFC 0024](./0024-declaration-and-package-identity.md), keyed by JSON
pointer, so moving an expression does not change its digest. Each operator
family has its own node kind, so an evaluator dispatches on a closed set.

| Node | Meaning |
| --- | --- |
| `lit` | A typed literal: `Bool`, `Int`, `Decimal`, `String`, `Date`, or an enum member |
| `fact` | A value the host supplies, identified by a declaration and a path (below) |
| `var` | A variable bound by `every`, `exists`, `count`, `collect` or `let` |
| `use` | A reference to a named expression declaration, by declaration identity |
| `not`, `and`, `or` | Kleene logic; `and` and `or` are n-ary |
| `if` | `cond`, `then`, `else` |
| `true?`, `false?`, `known?` | Two-valued tests that never return unknown |
| `some?`, `coalesce` | `Option` tests and defaults |
| `eq`, `ne` | Equality at one static type |
| `lt`, `lte`, `gt`, `gte` | Ordering on `Int`, `Decimal`, `Date` and `String` |
| `in` | Membership in a list of the same element type |
| `every`, `exists`, `count`, `collect` | Quantifiers and a map over a list, with a bound variable |
| `add`, `sub`, `mul`, `neg`, `sum`, `product`, `round` | Exact arithmetic on `Int` and `Decimal` |
| `concat`, `format` | String concatenation and typed formatting |
| `lookup` | A literal table from keys to expressions, with a required default |
| `add-days`, `add-business-days`, `format-date` | Date arithmetic and formatting |
| `let` | Local names for shared subexpressions |

There is no recursion, no user-defined function, no division, and no
higher-order value. `use` references must form an acyclic graph; the
checker rejects a cycle with the reference chain. Evaluation therefore
always terminates, and its cost is bounded by the size of the expression
times the size of the bound lists.

The core is written in Forma source as `type` declarations (a recursive
`(type Expr (Tagged ...))` in `preludes/expr.lisp`). Its Effect Schema,
TypeScript types and JSON Schema are generated by the build step in
[RFC 0022](./0022-type-schema-generation.md), which makes this IR that step's
first user.

### Unknown and Option

Unknown and `Option` are different things:

- **`Option`** is a declared shape: a field that may be absent by design.
  `None` is a known value.
- **Unknown** is an evaluation state. It means the host has no answer yet
  for a fact, or a value derived from one.

A `fact` of type `(Option T)` that the host knows is absent evaluates to
`None`. A fact the host has not determined evaluates to unknown. A host that
cannot tell the two apart, as onb-next's fact store cannot, binds "unset" to
unknown and declares its facts without `Option`.

The rules:

- `not`, `and` and `or` use strong Kleene logic. `(and false unknown)` is
  `false`; `(or true unknown)` is `true`. An empty `and` is `true` and an
  empty `or` is `false`.
- Every other operator returns unknown if any operand it needs is unknown.
  `if` returns unknown when its condition is unknown. When the condition is
  known, only the chosen branch is evaluated.
- `true?`, `false?` and `known?` turn unknown into `false`. With
  `coalesce`, they are the only operators that map an unknown operand by
  itself to a known value. (`and`, `or`, quantifiers and an unchosen `if`
  branch can still produce a known result when another operand decides it.) onb-next's
  `choose` lowers to `(if (true? c) a b)`, and its `is_set` lowers to
  `known?`.
- `every`, `exists` and `count` fold their predicates with the Kleene rules.
  `count` is unknown if any predicate result is unknown. A quantifier over
  an unknown list is unknown.
- `coalesce` returns its first operand that is known and not `None`,
  skipping unknown and `None` operands. If no operand qualifies, it returns
  unknown when any operand was unknown, and `None` otherwise. It is the
  explicit default for a fact that may not be known yet.

The evaluator returns `true`, `false` or `unknown` for a `Bool` expression
and leaves the policy to the host. The conformance suite states one rule
that every host keeps: **unknown is never reported as `false`**. A host
that raises compliance findings raises one only for `false` (or only for
`true` in a "never" monitor). A host that guards a commit may reject on
unknown. That is a policy the host writes explicitly with `true?`; it does
not follow from an evaluator default.

### Conventions are lowerings

The evaluator has no options. A consumer convention becomes ordinary core
syntax produced by its prelude. For example, onb-next's arithmetic counts an
unset input as 0, so a product with an unset input is 0. A prelude `sum`
form lowers each operand `x` to `(coalesce x 0)` before emitting `add`. The
fixtures pin the core semantics once, and each consumer's conventions are
visible in its own prelude source.

### Numbers

- **`Int`** keeps Forma's existing range and its error on overflow.
- **`Decimal`** is an exact base-10 number with at most 38 significant
  digits. It is encoded as a JSON string such as `"12.50"`. `add`, `sub` and
  `mul` are exact. The result's scale is the larger operand scale for
  `add`/`sub`, and the sum of the scales for `mul`. Rounding happens only
  through `(round x scale)`, which rounds half to even. `Int` is accepted
  where `Decimal` is expected.
- **`Float` is not portable.** A portable hole rejects a `Float` literal or
  `Float`-typed fact with `expr/not-portable` at its span. IEEE results
  differ between JavaScript, SQL `DOUBLE PRECISION` and decimal columns.
  Money and counts, which are what both consumers compute, need exact
  results.

Two existing gaps meet here:

- Forma's reader makes `1.5` a `Float`. Portable holes need a decimal
  literal spelling (see [Decisions](#decisions-still-required)).
- The kernel infers unannotated arithmetic as `Float`. A portable hole
  checks arithmetic with the numeric constraint proposed in
  [RFC 0019](./0019-everyday-checker-gaps.md) section 2, extended with a
  `Decimal` instance. Stage 3 waits for that stage of RFC 0019.

### Dates and calendars

- **`Date`** is a calendar date, encoded as `YYYY-MM-DD`. A host must reject
  an invalid date such as `2026-02-30` when it binds a fact. It never
  normalises one.
- Comparison orders dates chronologically. `add-days` adds a signed `Int`.
- `(add-business-days date days calendar)` counts `days` business days.
  Rules:
  - a positive count moves forward and a negative count moves backward;
  - zero returns `date` unchanged, even when it is not a business day;
  - the result is always a business day unless the count is zero.
- `calendar` is a `fact` of type `Calendar`, so the host supplies it:

  ```text
  Calendar = { id: String, version: String,
               weekend: (List Weekday),
               holidays: (List Date),
               covers: { from: Date, to: Date } }
  ```

  Holidays are concrete dates. Rule-based calendars, such as worldvm's "third
  Monday" holidays and observed-day shifts, are computed into dates by the
  host or a prelude before evaluation. The core never interprets rules. If
  a computation leaves `covers`, the evaluator returns the error outcome
  `expr/calendar-range`. It does not guess.
- `(format-date date pattern)` supports the tokens `yyyy`, `MM` and `dd`.
  Other characters are copied. There is no locale. The pattern must be a
  literal, so the checker validates it.
- There is no ambient clock. `today` is a fact the host binds, so an
  evaluation is a pure function of its facts.

Instants (date-times with a zone) are needed by both consumers but are left
to a later stage.

### Errors and totality

Evaluation of a well-typed expression over facts that match their declared
types returns a value, unknown, or one of these error outcomes:

| Code | Cause |
| --- | --- |
| `expr/int-overflow` | An `Int` result outside Forma's range |
| `expr/decimal-overflow` | A `Decimal` result above 38 significant digits |
| `expr/calendar-range` | Business-day arithmetic left the calendar's `covers` range |
| `expr/binding` | The host supplied a fact of the wrong type, an invalid date, or no value for a required declaration |

The TypeScript evaluator never throws for these. It returns
`{ _tag: "Value" | "Unknown" | "Error" }`, so a host chooses how to surface
an error. Equality and ordering are total, because the checker requires
both operands to have the same static type. `lookup` requires a default, so
a missing key is not an error.

### Binding facts

A `fact` node names a declaration identity, written as RFC 0024's
`{ package, name }`, and a path:

```json
{"node":"fact","decl":{"package":"people","name":"dob"},
 "path":[],"type":"Date"}
```

The path walks references, for example from a record to the attribute of
its referenced employer. Each hop names a declaration, not a string. A path
that crosses a list-valued hop has a `List` type, and only quantifiers,
`count`, `collect` and `sum` accept it.

The checker gets the names and types from the hole's existing `:scope`
function. A scope entry may now map a name to a fact descriptor rather
than a bare type:

```lisp
:scope {:when (fn [{:keys [subject]}] (facts-of subject))}
; facts-of returns {:dob {:fact 'dob :type (quote Date)} ...}
```

The prelude, not the engine, decides what a fact is. The host implements
one interface:

```ts
interface FactSource {
  read(fact: FactRef, context: EvaluationContext): FactValue; // value, None, unknown, or list
}
```

The evaluator does not walk paths through a fact store itself. It asks the
host for each `fact` node in a fixed order, which makes evaluation
deterministic and lets a host record reads, for example to build a
dependency graph or a journal ([RFC 0016](./0016-host-call-journals.md)).

### Authoring

A hole opts in with hole metadata, in the same position as refinements:

```lisp
(form (requirement name {:keys [applies-when satisfied-when]})
  :types {:name (Declares Requirement)
          :applies-when (Expr Bool :portable true)
          :satisfied-when (Expr Bool :portable true)}
  :scope {:applies-when subject-facts :satisfied-when subject-facts}
  :ir RequirementIR
  {:kind "Requirement" :name name
   :appliesWhen applies-when :satisfiedWhen satisfied-when})
```

In a portable hole:

- Only core operators and scope names resolve. Kernel spellings map to
  core nodes: `and`, `or`, `not`, `if`, `=` (`eq`), `!=` (`ne`), `<`, `<=`,
  `>`, `>=`, `+` (`add`), `-` (`sub` or `neg`), `*` (`mul`), `str`
  (`concat`) and `contains?` with a literal list (`in`). Every other core
  operator is written by its core name: `true?`, `false?`, `known?`,
  `some?`, `coalesce`, `every`, `exists`, `count`, `collect`, `sum`,
  `product`, `round`, `lookup`, `format`, `add-days`, `add-business-days`,
  `format-date` and `let`. Inside a portable hole these names refer to the
  core operators and shadow kernel builtins with the same name, such as
  `count` (list length) and `round` (`Float` to `Int`). Any other call
  reports `expr/not-portable` at the call.
- A prelude can add vocabulary with ordinary macros that expand to core
  syntax, such as the `sum` convention above or `(business-days-after d n
  :calendar us-federal)`.
- The hole's IR value is the typed tree. An `RuntimeExpr` IR field keeps
  today's `raw-expr` encoding for non-portable holes, so `ui`, `elm`,
  `email` and ontology payloads are unchanged.

A form can declare a named expression with `(Declares ...)` and a portable
hole. Another expression refers to it by name; the reference is emitted as
`use` with the declaration identity, and the evaluator resolves it from
the same artifact. This is how onb-next's named conditions map onto the
core.

## Alternatives considered

- **Specify `raw-expr` and keep it.** The tree carries no types or operator
  identities, so each host would still have to re-derive them, which is
  what worldvm does by re-parsing source.
- **Evaluator options for consumer conventions** (unset as 0, unknown as
  false). Options multiply the fixtures and let two hosts evaluate the same
  artifact differently. Lowerings keep the semantics in one place.
- **Unknown as `None`.** It conflates "absent by design" with "not yet
  known", which is the distinction worldvm needed. A host can still
  conflate them, as described above.
- **`Float` with documented rounding.** It would not be portable to SQL
  decimal columns or to languages without the same IEEE behaviour, and
  neither consumer needs inexact numbers.
- **Compile portable holes to Effect TypeScript.** That gives TypeScript
  hosts a fast path. It is not a substitute for a data IR, which SQL
  compilers, other languages, explainers and graph views all read.

## Conformance

`conformance/expr/` holds JSON fixtures. Each fixture is
`{ expr, facts, calendars, expected }`, where `expected` is a value,
`"unknown"`, or an error code. The fixtures are generated from Forma source
where possible, so the checker and the evaluator are tested together. They
cover:

- the Kleene truth tables for `not`, `and`, `or`, `if`, the two-valued
  tests, quantifiers and `count`;
- unknown propagation through every operator;
- `Option` versus unknown, and `coalesce` ordering;
- decimal exactness (`0.1 + 0.2 = 0.3`), scale rules, half-even rounding,
  and both overflow outcomes;
- business days forward, backward, zero, across weekends and holidays, at
  the edges of `covers`, and across a year boundary;
- `format-date` tokens and literal text;
- `lookup` default, and `use` resolution across declarations.

Checker fixtures pin `expr/not-portable` for a non-core call and for a
`Float` literal, a type mismatch in `eq`, a `use` cycle, and an unknown
scope name, each at its author span.

A **consumer parity** fixture set ports representative onb-next value-graph
and worldvm requirement cases into Forma source through each prelude's
lowerings. Where a consumer differs from the core, for example worldvm's
`String()` equality, the fixture records the difference and the lowering or
host change that removes it.

A second evaluator passes when it produces every `expected` outcome. The
TypeScript evaluator is the reference. The SQL guidance in stage 5 is tested
by running the same fixtures through a SQL translation against an embedded
database.

## Implementation stages and validation

1. **Schema, evaluator and logic fixtures.** Write the IR as Forma types,
   generate its schemas with RFC 0022 (or by hand until that lands), and add
   the evaluator with `Bool`, `Int`, `String`, enums, `fact`, `var`,
   logic, comparison, `in`, quantifiers, `coalesce` and `lookup`. Add a
   translator from today's `raw-expr` to the core for that subset, which
   uses the hole's scope types. Hosts can then evaluate existing payloads
   while authoring catches up. Fixtures for this subset.
2. **Portable holes.** The `:portable` hole metadata, restricted
   resolution, `expr/not-portable`, typed emission with span provenance, and `use`
   with cycle detection.
3. **Decimals.** `Decimal` with its literal spelling, arithmetic, `sum`,
   `product` and `round`, after RFC 0019 stage 7.
4. **Dates and calendars.** `Date`, `add-days`, `add-business-days`,
   `Calendar` facts and `format-date`.
5. **Instants and SQL guidance.** Instants with zones, and a documented SQL
   translation that keeps the Kleene rules.

Each stage adds fixtures before the change and runs `pnpm check`. The new
package and hole metadata need changesets.

## Decisions still required

- The decimal literal spelling: a reader suffix (`12.50M`), a call
  (`(decimal "12.50")`), or `Decimal` context turning `12.50` into a decimal
  inside portable holes only.
- Whether `if` on an unknown condition returns unknown (proposed) or takes
  `else`. Either way, the other behaviour is one lowering away.
- Whether `expr/calendar-range` should instead be unknown.
- Whether the evaluator ships as `@formalang/expr` with no engine dependency
  (proposed, so small hosts can import it) or as an export of
  `@formalang/ts`.
- How a scope declares facts: a prelude-level `facts-of` convention, or a
  first-class `(Fact T)` scope entry.
- Whether instants belong in the first release, given that both consumers
  use them.

## Related designs

- [RFC 0008](./0008-typed-form-results.md): typed reflection, which can
  supply fact scopes from declarations instead of hand-written scope
  functions.
- [RFC 0012](./0012-checked-evaluation.md): running untrusted source. A
  portable expression is a much smaller trust problem: it is data, it is
  total, and it cannot reach host capabilities.
- [RFC 0016](./0016-host-call-journals.md): fact reads in a fixed order
  can be journalled.
- [RFC 0021](./0021-ir-to-source.md): printing typed expression trees
  back to source is simpler than printing `raw-expr`.
- [RFC 0025](./0025-consumer-prelude-sdk.md): sensitive facts restrict
  which core operators apply.
