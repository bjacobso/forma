# Outcome

Both layers and the embedding app work offline using the installed package. No network, sibling checkout, or Forma implementation source was consulted. Inputs were the copied documentation, CLI help, and observed results. Node printed a minified package implementation line automatically in an initialization exception stack; I did not use that line to investigate the implementation.

- `src/policy.lisp`: category/role/expense types, `required-approvals`, `approvable?`, and metadata validation. Amounts are integer cents; dates are integer epoch days. Any expense above 250,000 needs **both** roles, even a non-meal. Meals above 7,500 need a manager. Thresholds are strict.
- `src/policy-test.lisp`: 20 cases; evaluates to `[]` when they pass.
- `src/expenses-forms.lisp`: an exported `expense` form, typed IR, and source-located checks for missing/blank vendors, missing/blank asset tags, and either role approving their own expense.
- `src/expenses-valid.lisp`: six accepted declarations. `src/expenses.lisp` imports these and declares four deliberately invalid expenses. The whole graph fails with all four expected diagnostics.
- `app.mjs`: loads the policy as a prelude, checks `src/agent.lisp`, and runs it with exactly one configured capability, `notify`. It asserts zero calls during checking, one during execution, and no additional call when checking an ungranted capability fails.
- `verify.mjs`: asserts the policy result, six form IR records, all four rejection codes and source lines, and detection of an intentionally flipped test expectation.

Run these exact commands from this directory (no installation or network needed):

```sh
node_modules/.bin/forma check src/policy.lisp
node_modules/.bin/forma run src/policy-test.lisp
node_modules/.bin/forma check src/expenses-valid.lisp
node_modules/.bin/forma file declarations src/expenses-valid.lisp
node_modules/.bin/forma check src/expenses.lisp
node verify.mjs
node app.mjs
```

The `expenses.lisp` command intentionally exits **1**; the other commands exit **0**. Policy tests print `[]`; verification prints its success summary; the app returns `Notified: Expense needs 2 approvals.` Evidence is under `evidence/`.

Scope choices: `approvable?` asks whether a distinct person may supply a required role approval; it does not claim that all approvals have been collected. Role assignment/authentication belongs to the host. Forms can describe pending expenses: their checks enforce rules 4 and 5, while the pure policy computes rules 2 and 3. Names are employee identifiers; no 200-person directory was supplied or invented. Nonnegative amounts and nonblank required metadata are additional modeling choices.

# Timeline

UTC timestamps were obtained with `date -u`. Elapsed minutes are rounded from the recorded start.

| Milestone | UTC, 2026-11-11 | Elapsed minutes |
| --- | --- | ---: |
| Start | 21:21:35 | 0.00 |
| First recorded successful `forma check` | 21:22:03 | 0.47 |
| Policy tests passing (`[]`) | 21:22:38 | 1.05 |
| First running custom form: check passes and declarations/IR listed | 21:23:02 | 1.45 |
| Embedding app working, including assertions | 21:23:37 | 2.03 |

The first check invocation had already written `0 errors, 0 warnings`, but my shell timestamp wrapper failed afterward. I reran it and recorded the successful wrapper time above rather than inventing an earlier timestamp. Policy tests happened before the custom-form milestone. Raw timestamp output is preserved in `evidence/timeline.tsv`; its tab markers are literal escape text, an incidental logging-format mistake.

# Findings, ranked by time cost

Time costs below are rough estimates, not instrumented phase measurements. A “turn” here means one tool/repair round, not a user intervention. No user repair guidance was needed.

1. **A file module is not directly usable as a facade prelude.** Estimated 10–15 seconds, 1 failed round plus repair. I passed the unchanged `policy.lisp` to `createLanguage({ preludes: [...] })`. Creation threw `LanguageInitializationError: Could not initialize Forma preludes. Inspect diagnostics for details.` Its diagnostic was `typecheck/unbound-symbol`, `Unbound variable: export`, at `policy.lisp:33:2`. `embedding.md` says prelude initialization validates/evaluates declarations with `kind: "prelude"`; `modules.md` distinguishes source-loading from module imports, but neither gives a recipe for sharing an exported policy module with this facade. I removed the single top-level export line in the app's prelude adapter, preserving all policy definitions unchanged. The adapter asserts that a replacement occurred. Full original exception: `evidence/embedding-initial-failure.txt`. This is a narrow adapter for this file's one-line export, not a general module loader.

2. **Literal enum lists do not unify through a generic test assertion as expected.** Estimated 8–10 seconds, 1 failed round plus repair. `(is "meal over threshold" (required-approvals (sample 7501 "meals")) ["manager"])` failed with `error[typecheck/type-mismatch]: Cannot unify Union<"manager", "finance"> with String` at `src/policy-test.lisp:11:4` (then-current layout). I followed the generic `is` pattern in `authoring.md`; the form guide documents enum membership but not this generic-list interaction. Explicitly annotating `manager-only` and `both-roles` as `(List ApprovalRole)` solved it. No policy change was necessary.

3. **Record Option convenience does not cover all the places I expected.** Estimated 8–10 seconds total, 2 failed rounds plus repairs.
   - An inline argument to `valid-details?`, with `:vendor "Acme"` and omitted asset tag, failed with `error[typecheck/type-mismatch]: Cannot unify String with Option<String>` at `src/policy-test.lisp:32:92` (then-current layout). I changed inline arguments to explicit `(Some ...)` and `None` fields.
   - The embedded program's explicitly annotated `request` with both optional fields omitted failed with `typecheck/type-mismatch`, `Missing field(s) in record`; details were `missingIn: "left"`, `fields: [":asset-tag", ":vendor"]`, span `agent.lisp:3:17` through `3:82`. I added both `None` fields. Full assertion output: `evidence/embedding-option-failure.txt`.
   - `authoring.md` says named-record literals fill omitted optional fields and wrap bare values, including imported types. The inline-call case is less explicit there; the annotated facade/prelude case is particularly surprising. I did not isolate the engine cause, so this is an observed boundary difference, not a claim about its internals.

4. **Initial documentation read was too broad for the output budget.** Estimated 5–10 seconds, 1 extra read round. I batched nearly all copied docs, and the tool reported `Warning: truncated output (original token count: 22967)`. This was my reading strategy, not a Forma failure. I reread `writing-a-form.md`, `embedding.md`, and `authoring.md` individually with sufficient output budgets. Those were enough to implement the task; unavailable linked examples were not needed.

5. **My timestamp wrapper used zsh's read-only `status` variable.** Estimated 3–5 seconds, 1 extra round. Exact shell error: `zsh:35: read-only variable: status`. The Forma check itself succeeded. Renaming my shell variable to `trial_exit` fixed the wrapper. This is author/tooling overhead, not a Forma docs defect.

The form definition itself worked on its first attempt. In particular, optional-hole nil checks, `:slot` locations, imported enum aliases, and IR omission of absent metadata all behaved as documented. No `forma test` command was guessed or attempted: the docs explicitly say there is no test runner.

# Silent traps

- The default capability scheme is permissive. Both embedded check and run succeed, but their reported type is `{"kind":"display","display":"Unknown"}`. This demo verifies the actual message/result with JavaScript assertions; it does not demonstrate a statically typed capability contract. `embedding.md` documents the permissive default and optional `typeScheme`, but not the concrete schema needed for a simple String-to-String capability.
- `forma run` exits 0 even when a test file evaluates to a nonempty failure list. The mutation check proves this: the altered suite prints `["meal at threshold"]` while the command succeeds. This behavior is documented. `verify.mjs` explicitly asserts the value instead of relying on process exit alone.
- An omitted `(Option String)` form hole is raw `nil` inside hooks, while policy record fields are `Some`/`None`. I followed the explicit warning in the docs. Sharing a policy helper directly with these hooks would require conversion; the hook intentionally validates its own raw values.
- `check` does execute form validation hooks sufficiently to reject these declarations; ordinary checked policy code is not executed. The facade's check also makes zero notify calls, as asserted.
- Valid form declarations do not automatically mean an expense is fully approved. A high expense may still be pending; collecting manager/finance approvals is distinct from validating declaration metadata. The fixtures include both approvers on high expenses, but this form does not enforce completed workflow state.
- No identity/role directory is provided. Passing `"manager"` to `approvable?` asserts that role; Forma cannot establish a person's actual organizational authority from a string.
- A missing vendor/tag has no authored value to underline. The check points to the category that creates the requirement. A self-approval points directly to the authored approver string. The four exact excerpts are in `evidence/rejections.txt`.

# Docs gaps

1. A supported bridge between an ordinary exported policy module and the `createLanguage` prelude API. Show whether to adapt exports, supply bundles, or choose a different API. The two workflows are individually documented but do not compose directly here.
2. A precise table for Option normalization: annotated definitions versus inline function arguments, file-module checking versus facade/prelude checking, and form-hook plain values. The current broad record claim left two repair rounds.
3. A literal-union/list example through a generic function, including when annotations are required. The generic assertion sample works for simpler types but did not prepare me for approval-role lists.
4. A complete `typeScheme` example for a typed capability in the facade docs, plus an example of the actual `check().type` return shape and default `Unknown` behavior.
5. A copyable CI runner that fails on a nonempty Forma failure list. The docs explain this requirement but leave the runner to the author and link a trial absent from this copied docs set.
6. Several useful-looking links point to material not included in this directory (domain modeling, Effect reference, kernel sources, runnable embedding example). The copied core guides were sufficient here. Avoiding `and`/`or`/`not` in modules let me use only built-in `if` without needing the referenced kernel library file. An outside-author docs bundle should distinguish installed resources from source-checkout-only paths.

Positive documentation evidence: `authoring.md` accurately described local CLI invocation, no test framework, declaration inspection, explicit signatures, day-number dates, and source-located hook diagnostics. `writing-a-form.md` supplied enough detail to write the keyword-option form without inspecting package implementation code.
