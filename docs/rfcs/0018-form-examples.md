# RFC 0018: Checked form examples

| | |
| --- | --- |
| Status | Proposed; not implemented |
| Created | 2026-10-16 |
| Scope | The `:examples` option on `form`, checking examples when a form is defined, examples as tests, examples in completion and the host, a form catalog, conformance |
| Direction | A form declaration carries source examples with expectations; the engine checks them when the vocabulary loads, runs them as tests, and serves them to editors and programs that write programs |

## Summary

A `form` declaration can list examples of its own use. Each example is a
small program with an expectation: the projected IR it produces, the type it
has, or the diagnostic it must be rejected with. Loading a prelude checks
every example against the form as defined. An example that no longer
elaborates is a diagnostic at the example, and the vocabulary does not load.

```lisp
(form (greeting name message {:keys [doc]})
  "Declare a greeting."
  :types {:name (Declares Greeting) :message String :doc (Option String)}
  :ir GreetingIR
  :check (fn [{:keys [message]}]
    (if (= message "") [{:severity :error :code "greeting/empty"
                         :message "Provide a greeting message." :slot :message}] []))
  :examples
  [(example "minimal" (greeting welcome "Ada"))
   (example "with a doc"
     (greeting welcome "Ada" :doc "Shown on arrival")
     :ir {:kind "Greeting" :message "Hello, Ada" :doc "Shown on arrival"})
   (example "rejects an empty message"
     (greeting welcome "")
     :rejects "greeting/empty")]
  {:kind "Greeting" :name name :message (greeting-message message) :doc doc})
```

The same examples are the form's documentation in completion and hover, one
entry each in [RFC 0015](./0015-tests-in-forma.md) test results, and the
content of a new `formCatalog` host operation that returns every form a
session knows together with its pattern, hole types, IR type, docstring, and
checked examples.

## Motivation

Forma's claim is that domain vocabulary is library code: a `form` is the
compiler's check, the editor's outline, and the artifact's contract at once
([Writing a form](../writing-a-form.md)). If every domain is to be expressed
as forms, the cost of defining a form, and the trust a reader can place in
one, is the lever. Today a form carries a docstring, hole types, and a `:check`
function. Nothing demonstrates that any program using it elaborates. The
first program that exercises a form is the first test of its definition, and
that program belongs to the form's user, not its author.

Three readers need the same artifact:

- **The form's author** needs a definition-time check. A change to a hole
  type, a `:scope` function, or the projection body should fail at the
  definition when it breaks a known-good use, not in a downstream module.
- **An editor user** needs to see a working application of the form, not
  only its pattern. Completion today inserts the shape; hover shows the
  docstring.
- **A program that writes programs** needs retrieval that returns the
  vocabulary and verified uses of it in one step. Forma's vocabulary is
  small and absent from training corpora, so in-band, checked examples are
  the practical substitute for corpus size. An example that the engine has
  checked is a better prompt than prose that may have drifted.

Examples also give conformance a surface that lives next to the vocabulary.
Every prelude form with an example is pinned without a separate golden.

## Current state

- **`:examples` is reserved and ignored.** The unified `form` parser
  (`packages/ts/src/surface/form.ts`) accepts `:examples` in its option list
  and does nothing with it. [RFC 0001 §4.10](./0001-unified-syntax.md#_4-10-forms-and-macros)
  reserved it for "documentation and completion". No prelude in `preludes/`
  uses it.
- **Legacy descriptors keep strings.** The older descriptor parser
  (`packages/ts/src/descriptor/parse-descriptor.ts`) reads `:examples` string
  literals into `FormDescriptor.examples`, and
  `FormDescriptorRegistry.getExamples` returns them. Nothing calls it. The
  strings are never parsed or checked.
- **Editor services show docs, not examples.** Slot and form summaries in
  `packages/ts/src/editor/slots.ts` carry `doc` from descriptors and slot
  specs. There is no field for an example.
- **Definition checks are structural.** `checkDescriptors` and the
  `conformance/descriptor-metacheck/` cases validate the shape of a form or
  descriptor declaration: unknown slots, hook clauses, unresolved hooks. They
  do not elaborate any program that uses the form.
- **Form bodies run pure code.** A form's projection body and `:check`
  function run at compile time with pure builtins and a step limit. Host
  builtins are not in scope. Examples can be checked under the same rules.
- **No tests.** There is no `test` declaration and no `runTests` operation;
  [RFC 0015](./0015-tests-in-forma.md) proposes both.
- **Docs are unchecked.** The examples in [Writing a form](../writing-a-form.md)
  and the prelude docstrings are prose. Nothing fails when they stop
  elaborating.

## Proposal

### Example entries

`:examples` holds a vector of `example` entries:

```lisp
(example "name" top-level-form ... [:ir value] [:type Type] [:rejects "code"])
```

- The name is a string literal, unique within the form. An example is
  identified by form name plus example name.
- The body is one or more top-level forms. The last one must be an
  application of the form being defined; earlier ones may declare whatever
  it needs, such as an entity that a query example refers to. The examples
  of a prelude are checked after every form in that prelude is registered,
  so an example may use sibling forms.
- `:ir value` is a pure Forma expression. The example passes when the last
  form's projected IR is structurally equal to the value after both are
  normalized through the form's `:ir` type. Fields holding declared symbols
  compare by name.
- `:type Type` applies to expression-typed forms, those with `:type`. The
  example passes when the last form's type equals it.
- `:rejects "code"` marks a negative example. It passes when checking the
  body reports at least one error with that code and no error with another
  code.
- An example with no expectation passes when the body elaborates without
  error.

Example bodies are checked as a module in a scratch scope that sees the
declaring prelude and its preludes. Names declared by `(Declares T)` holes
in an example are bound in that scope only. Examples are not exported, do
not appear in artifacts, and are not evaluated at run time. Like form
bodies, they cannot reach host builtins.

### Checking when the form is defined

Loading a source that declares forms checks their examples after descriptor
validation and registration. A failed example is reported at the example's
span with the inner diagnostics attached:

| Code | Meaning |
| --- | --- |
| `descriptor/example-failed` | the body did not elaborate, or an expectation did not hold |
| `descriptor/example-accepted` | a `:rejects` example produced no error with the named code |
| `descriptor/example-form` | the last form in the body is not an application of this form |

A source with a failed example does not load. This is the same atomic rule
`loadSource` applies to other definition errors. Hosts that load preludes on
every editor keystroke can pass `examples: "skip"` to `loadSource`;
`check` is the default. Editor descriptor derivation
(`editorDescriptors`) never checks examples, because it must keep working
while a prelude is being written.

### Examples as tests

Under [RFC 0015](./0015-tests-in-forma.md), `runTests` on a module that
declares forms reports one `TestResult` per example, named
`<form>/<example>`, in source order after the module's `test` declarations.
`forma test preludes/ontology.lisp` then runs every ontology example, and a
conformance fixture can store the outcomes. Until RFC 0015 lands, examples
are checked only at load and reported through `loadSource` diagnostics.

### Examples in services and the host

- **Descriptors.** `FormDescriptor.examples` becomes structured:
  `{ name, source, span, expect }`, where `expect` records the `:ir`,
  `:type`, or `:rejects` expectation. Legacy string examples remain as
  source-only entries with no expectation and are not checked.
- **Editor.** Form summaries in `editor/slots.ts` gain `examples`. Completion
  detail and hover show the first example's source. The workbench shows the
  full list for a selected form.
- **Catalog.** A new host operation returns the vocabulary a session knows:

```ts
interface FormCatalogRequest {
  readonly sessionId: string;
  readonly names?: readonly string[];   // default: every form
}
interface FormCatalogEntry {
  readonly name: string;
  readonly phase: "meta" | "domain";
  readonly doc?: string;
  readonly pattern: string;              // the form as written in its declaration
  readonly holes: readonly { readonly name: string; readonly type: string; readonly doc?: string }[];
  readonly ir?: string;                  // IR type name
  readonly type?: string;                // result type, when static
  readonly examples: readonly { readonly name: string; readonly source: string;
    readonly expect?: { readonly kind: "ir" | "type" | "rejects"; readonly value: string } }[];
  readonly source: { readonly sourceId: string; readonly span: Span };
}
```

`formCatalog` is derived from descriptors and their checked examples. It
is the machine-readable form of the claim that a prelude is a tool catalog:
a program selecting a form gets its contract and verified uses in one call.
The JSON CLI exposes it through `request` and `daemon` like the rest of the
ABI.

- **Docs.** [Writing a form](../writing-a-form.md) and prelude reference
  pages can be generated from `formCatalog`, so the published examples are
  the checked ones. Generation is a later stage; the first stage only
  requires that the hand-written examples in that page also appear as
  `:examples` on the forms they describe.

### Prelude coverage

Every `form` in `preludes/` gains at least one example. A test enforces this
with an explicit exemption list that is only allowed to shrink. Forms whose
examples need children, declared entities, or scope bindings use the
multi-form body.

## Alternatives considered

- **Documentation strings only.** This is the legacy parser's behavior and
  the status quo of the reserved option. Unchecked examples drift, and they
  cannot gate a definition.
- **Tests in separate files only.** RFC 0015 tests can exercise a form, but
  they do not travel with the descriptor, are invisible to completion and the
  catalog, and do not run when the prelude loads.
- **Extracting examples from docstrings.** Doctest-style extraction keeps
  prose and code together but makes expectations implicit and parsing
  brittle. Explicit entries carry a name and an expectation.
- **Generating examples from hole types.** Property-style generation would
  follow from types as schemas, but it needs generators, shrinking, and
  seeds, and it cannot express a form's intended use.
- **Checking examples lazily, on first use of the form.** This moves the
  failure back to the user's module. Rejected; load-time checking with an
  explicit `skip` is the proposal.

## Conformance

A new fixture, `conformance/form-examples/`, holds preludes whose forms carry
examples, with expected `loadSource` diagnostics stored as reviewed goldens.
Required cases: a passing example; an example whose IR expectation does not
hold, with the actual IR in `details`; a `:rejects` example that is accepted;
a body whose last form is another form; an example that uses a sibling form
and a declared entity; a prelude loaded with `examples: "skip"`; and an
example that references a name it did not declare.

The prelude coverage test runs in `packages/ts/test`. The
`descriptor-metacheck` cases are unchanged: shape validation still runs
first, and examples are checked only for forms that pass it.

## Implementation stages and validation

1. **Structured examples and load-time checking (TypeScript).** Parse
   `example` entries in the unified `form` parser, store them on
   `FormDescriptor`, check them in prelude and file-module loading, and add
   the three diagnostic codes to the catalog proposed in
   [RFC 0017](./0017-diagnostic-catalog.md). The conformance fixture above.
2. **Services and the host.** `examples` in editor form summaries, the
   workbench form panel, and `formCatalog` in the host ABI and JSON CLI.
   Tests pin the catalog for the `greeting` form and for one ontology form.
3. **Prelude coverage.** Examples on every shipped form and the ratchet
   test. The examples in [Writing a form](../writing-a-form.md) move onto
   the forms they describe.
4. **Tests.** Examples reported through `runTests` and `forma test`, once
   [RFC 0015](./0015-tests-in-forma.md) stage 1 exists.

## Decisions still required

- Whether `:ir` expectations compare the whole projected value or allow a
  partial match, and how declared symbols and absent optional fields are
  displayed in the diagnostic.
- Whether load-time checking is on by default for production hosts that load
  preludes at startup, given the added latency, or only in `forma test`, the
  conformance suite, and editor-driven checks.
- Whether examples may name scope bindings for `(Expr T)` holes directly,
  or must always construct the declarations that provide them.
- Whether examples should appear in artifacts as documentation, or stay out
  of artifacts like tests.
- Whether `formCatalog` belongs in the host ABI or in the language services
  surface described in [Language services](../language-services.md).

## Related designs

Rust documentation tests compile and run the code blocks in doc comments
under `cargo test`, so published examples cannot drift from the API. Elixir
and Python doctests do the same for REPL transcripts. JSON Schema and OpenAPI
have `examples` keywords that are documentation only and are not validated
against the schema by the specification. Tool definitions for language
models carry a description and a parameter schema but no checked examples;
`formCatalog` is the same shape with semantics, checks, and verified uses
attached.
