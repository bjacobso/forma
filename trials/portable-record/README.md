# Bounded portable-record experiment

This is a local experiment, **not a new Forma backend or macro API**. One
closed operation wraps each field of a known string record in `{ raw: value }`.
The operation is implemented once in `generate.mjs`, producing concrete
TypeScript and Go source. Rust, arbitrary TypeScript types, effects, foreign
calls, and general typed AST construction are out of scope.

## Run

From the repository root, with Node 24, workspace dependencies, and Go 1.24:

```sh
pnpm --filter @formalang/ts build
pnpm --filter @formalang/host build
node trials/portable-record/run.mjs
```

If Go is not installed, the orb's existing mise can install it without changing
the repository's main toolchain or adding a requirement to normal `pnpm check`:

```sh
mise install go@1.24.0
mise exec go@1.24.0 -- node trials/portable-record/run.mjs
```

The runner uses the built public Forma JSON CLI, the workspace TypeScript
compiler, native `go build`, and actual Node/Go executions. It prints the exact
generated sources and cost inventory. Temporary modules, binaries, and mutation
probes live in an OS temporary directory and are deleted even on failure. Go's
normal compiler cache remains. This optional trial is not part of `pnpm check`.

## Authoring and contract

`forms.forma` defines the typed hole and projected IR contract. The runner
prepends it to each schema before calling both `file typecheck` and
`file declarations`. For example, `base.forma` is:

```lisp
(wrap-record Query
  [{:name "id" :type "string"}
   {:name "cursor" :type "string"}])
```

`changed.forma` renames `id` to `account_id` and adds `label`. The same generator
handles both schemas without changes. The schema snippets are inputs to the
runner, not standalone modules importing the form library.

Supported input: a nonempty, explicitly enumerated record called `Query`, with
unique field names matching `[a-z][a-z0-9_]*` and required string fields only.
Output names `Query`, `UserFields`, and `wrap`/`Wrap` are fixed. Go exports
fields as `F_<name>` and uses JSON tags to preserve the wire names. This is an
injective mapping, not an idiomatic naming-policy framework. Unicode **values**
are supported; Unicode **identifiers** are intentionally rejected.

The behavioral contract is only preservation of each field's string value
inside its corresponding `raw` field. Wire comparisons parse JSON; property
order and escape spelling are not part of the contract. Inputs are valid closed
records containing Unicode scalar values; missing/extra fields, nonstrings,
invalid UTF-8 and lone UTF-16 surrogates are outside the input domain. The test
adapters are not runtime validators for arbitrary JSON. No claims are made
about mutability, aliasing, deep immutability, ownership, or async semantics.

## Verification and guarantee boundaries

- **Forma:** typed field holes and projected `RecordIR` are checked through the
  public CLI. A number field and optional-field metadata fail with
  `elaborate/form-check`; an unbound generic `T` fails with
  `module/compile-time-data`. Each has an authored line/column span. This is
  checked domain-data construction, not certification of a generator's body.
- **Generator validation:** after successful Forma elaboration, duplicate
  names, nonportable names, injection-shaped names, and an empty record are
  rejected before either source string is returned. These errors currently
  identify the field but do not carry Forma source spans. Output is deterministic
  for the same elaborated payload. There is no target-expression type system
  implemented in this generator.
- **Target compilers:** strict `tsc` and `go build` accept the unchanged emitted
  sources and native consumers. Both reject an injected number in a string
  result. The generator itself does **not** catch that constructor bug.
- **Behavioral tests:** `cases.json` contains six manually written input/expected
  pairs, independent of the generator and of the direct baseline. Cases cover
  asymmetric field values, empty strings, quotes/newlines/backslashes/NUL,
  Japanese/Arabic, emoji with modifiers and ZWJ, and combining characters without
  normalization. Six cases × two targets × generated/direct = 24 comparisons.
  A planted wrong-field substitution still compiles on each target, but the
  independent asymmetric oracle detects it. This is bounded conformance, not a
  proof of equivalence for all strings or all programs.
- **Schema maintenance:** stale output from both approaches fails compilation
  against the changed native consumer; regenerated output and explicitly
  maintained direct implementations pass all changed cases. Native consumers
  are assembled from the expected fixture's public field names, not the
  generator's schema or output.

## Baseline and cost

`baseline/base.ts` and `baseline/base.go` are direct implementations written by
the implementing LLM, without invoking `generate`. Their `changed` counterparts
are direct edits for the same rename/addition. The adapters, target compilers,
and expected cases are shared with generated output. Both approaches passed;
neither required a correctness repair after its first native compilation.

This is **not** a blind or statistically meaningful LLM benchmark. The same
agent wrote the generator, direct sources, and oracle. No independent agent or
model was invoked; no human/model author-time measurements were collected.
Independent expected values mean they are manually specified rather than
derived from either implementation, not that their author was independent.

The runner measures nonblank/non-comment lines and a comment-free textual diff:

- Shared form definition: 6 lines; generator: 49 lines; base schema: 3 lines.
  Thus the initial generated path is **58 lines**, before validation tooling.
- Direct base implementations: TS 5 + Go 15 = **20 lines**.
- Schema change: **+3/−2** schema lines; **zero generator edits**.
- Direct maintenance: TS **+3/−3**, Go **+7/−5**. Go's count includes alignment
  changes from `gofmt`; these counts are formatting-sensitive, not work-time.
- The shared verification runner and JSON fixtures are additional retained
  cost, printed/reviewable separately; they are not charged only to the direct
  baseline. Forma builds, toolchain setup, and the two encountered CLI issues
  are also real setup effort, not free benefits of the generator.

**Recommendation:** the bounded cross-target transformation works, but this
tiny workload does not justify a generic multi-host framework. Direct code is
smaller even after one schema change, so net maintenance savings are unproven.
Retain this as a runnable trial. Consider a larger experiment only for a real
consumer with many schemas or frequent synchronized changes, where fewer
independent edit sites could amortize generator and validation costs. Better
LLMs strengthen the direct baseline; they do not eliminate deterministic
regeneration or independent checking when those are actually needed.

## Findings and limits of the run

Verified in the orb on Node 24.14.1, TypeScript 6.0.3, Go 1.24.0 linux/amd64:
**25 checks, 24 independent expected-result comparisons passed**. Both target
compilers rejected the type-error controls and accepted the semantic-error
controls that behavioral tests caught. This is real CLI-to-native execution,
not a mock or an AST-shape-only check. The optional trial changes no engine,
website, package manifests, or public APIs; the full repository suite was not
run for these isolated trial files.

Two authoring approaches failed during setup and were not counted as successful
verification: nested child forms through the file CLI reported `Unbound symbol:
field`, and an excess top-level `:optional` argument reported unlocated
`internal/error: Too many positional arguments`. They were left out of scope
and suggested separately. The final experiment uses an inline typed record-list
hole (a named list element can be interpreted as a child-form category), and
tests optionality via extra field metadata with a proper located diagnostic.
It does not weaken the oracle to accept the earlier failures.

No Rust output, universal translation, independent core rechecker, formal
preservation proof, performance advantage, or novelty claim is established.
Publishing and deployment are not part of the trial command.
