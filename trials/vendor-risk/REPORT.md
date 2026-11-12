# Cold-author trial: vendor risk review in Forma

## The brief (source for every file here)

Vendor risk review for a 200-person SaaS company:

1. Every vendor that touches customer data needs a security review before contract signature: a completed security questionnaire and either a current SOC 2 Type II report or an approved exception.
2. Reviews expire after 12 months and must be redone.
3. High-risk vendors (those processing customer personal data) also need a data processing agreement on file.
4. Exceptions are approved only by the CISO, must give a reason, and expire after 6 months.
5. Procurement must not mark a vendor active while its review is incomplete or expired.

Synthetic data only. This is illustrative, not compliance advice.

## What "using Forma" means here (decision)

The README says Forma is "a programmable type system for Lisp": preludes define typed forms that "take part in checking", and a program "can evaluate to a value or elaborate into a typed description". So I built two layers:

- **`src/policy.lisp`**: types (`Vendor`, `Review`, `Exception`, `Role`) and pure policy functions (`activation-blockers`, `can-activate?`, `can-sign-contract?`, `exception-valid?`, ...). It is checked with `forma file typecheck` and run with `forma file evaluate`.
- **`src/register-forms.lisp` + `src/register.lisp`**: a small domain language. The form `(vendor name :status ... )` has a `:check` that rejects `:status "active"` while the vendor has blockers. It is elaborated with `forma file declarations`.

There is no published CLI. The only runner the README points to is the repository JSON CLI, `node packages/host/dist/cli.mjs`. Forma has no test framework, so tests are a Forma file that evaluates to its list of failing cases, plus `tests/run.mjs`, which drives the CLI.

## Run it

```sh
export PATH=/opt/node24/bin:$PATH          # default node here is 22
pnpm install --frozen-lockfile
pnpm --filter @formalang/ts build && pnpm --filter @formalang/host build
node trials/vendor-risk/tests/run.mjs
```

Final output:

```text
ok   policy typechecks
ok   policy tests typecheck
ok   policy tests: no failing cases
ok   mutant suite reports the flipped case
ok   register elaborates without diagnostics
ok   bad register is rejected with vendor/active-without-review
ok   TRAP: `file evaluate` runs an ill-typed program
ok   TRAP: bad register reports only the first of 3 violations
ok   TRAP: generic fn used in two top-level defines is rejected
ok   TRAP: implicit Some-wrapping fails for an imported record type
ok   TRAP: imported fn with inner lambda is nil inside a form :check
ok   TRAP: register's own vendor IR is absent from `file declarations`

all passed
```

The `TRAP` lines assert current, surprising behaviour so that the traps stay reproducible. They do not mean the behaviour is right.

## Outcome

| Brief rule | Policy functions (evaluate) | Register language (elaborate) |
| --- | --- | --- |
| 1. Customer-data vendor needs a review before signature: questionnaire + (SOC 2 Type II or exception) | **Expressed and passing** (7 cases) | **Expressed and passing.** Restated locally; see F4. |
| 2. Reviews expire after 12 months | **Partial, passing.** Uses Int day numbers with 365 days, because there is no date type (F7). SOC 2 "current" is interpreted as issued within 365 days. | Partial, same approximation |
| 3. High-risk vendors need a DPA | **Expressed and passing** | **Expressed and passing.** Negative fixture `no-dpa`. |
| 4. Exceptions: CISO only, reason given, 6-month expiry | **Partial, passing.** CISO is checked through a typed `Role` union. 6 months is approximated as 182 days. "Reason" means non-empty only: `" "` passes, because I found no documented trim function. | Partial. The approver is a free `String` (`"ciso"`) and the reason is not modelled. |
| 5. Cannot mark active while review incomplete or expired | **Expressed and passing** (`can-activate?`) | **Expressed:** `vendor/active-without-review` at `:status`. Only the first violation is reported, and I could not obtain the elaborated IR (F3, traps). |

"Contract signature" uses the same gate as activation (`can-sign-contract?`). The brief does not model a separate signature workflow.

## Timeline

1. Read the README. It has no "write and run your own file" section. `pnpm install --frozen-lockfile` worked on Node 24. The default Node here is 22, and pnpm did not warn about it.
2. Read the language guide and *Writing a form*. Neither says how to run a file. I found the CLI build commands in *Structure and Interpretation of Forma Programs* → "Running the examples".
3. `cli.mjs --help` printed usage but exited 64. The usage line revealed `file <typecheck|evaluate|interface|declarations>`. That command is the most useful thing I found, and no guide mentions it.
4. First probe: `file evaluate` returned `ok:true` for a program that `file typecheck` rejects (trap T1).
5. `and`, `or` and `not` failed with `module/unimported-sugar: Import and from a library or select a project prelude.` *File modules* hints at `preludes/modules/kernel.lisp`. Importing `[and or not]` from it by relative path worked.
6. `string/trim` produced `Unknown module namespace string.` I found no list of builtins and dropped the trim.
7. Building the blocker list with `conj` failed with `Unbound variable: conj`. The SICP guide notes that `conj`/`concat` don't typecheck. I rewrote the list as a fixed vector of `{:failed :reason}` checks passed through `filter`/`map`.
8. The tests failed with `Cannot unify Int with Option<Int> (at offset 551)`: implicit `Some`-wrapping does not happen for an *imported* record type (T3). I spelled out `(Some 800)` and `:exception None`.
9. The tests then failed with `Cannot unify List<String> with Bool (at offset 1768)`, even after I gave `is` the signature `(-> String a a Case)`. Probes showed that a generic top-level function used inside another top-level `define` is instantiated once (T2). I split it into monomorphic `is` and `is-list`. Throughout, `file evaluate` returned `[]` (all passing), so I would never have seen this without also running typecheck.
10. Policy and tests passed. The mutation check confirms that a flipped expectation is reported.
11. Register forms: `Public VendorIR exposes private type VendorStatus` was clear, and I fixed it by exporting `VendorStatus`.
12. Calling the imported `activation-blockers` from `:check` failed with `internal/error ... :check <anonymous> of form vendor__forma_2f686f6d65...: Cannot call nil as function`, with no span. Bisecting showed that an imported function with no calls works, but one using `or` or an inner `fn` is `nil`. Another imported function caused a spurious `Type mismatch: Float vs Int` (F4). Exporting every helper did not help, so I restated the gate inside the form module.
13. `No pattern matched the value`: hook holes are plain values or `nil`, not `Option`. The checker then typed `(= start nil)` as forcing `Unit` (F6). I switched to required holes with `-1`/`""` sentinels.
14. `Effect TypeScript does not support inferred open-row exports yet; supply a closed signature.` This came from a form module that uses no Effect at all. A closed `Facts` record signature fixed it.
15. The register elaborated. The negative fixture with 3 violations reported 1, with offsets but no line or column. The vendor IR never appears in `file declarations` output (F3).

## Findings, ranked by time cost

**F1. Imported code silently diverges between checking, evaluation and form hooks.** This cost about 8 turns. It covers T2, T3 and F4: each layer accepted code that another layer rejected.
- *Wish:* "Functions you import can be called from a form's `:check`, and generic functions stay generic across top-level `define`s", or a documented list of the cases where they can't.

**F4. Calling imported functions from `:check` fails at elaboration.** The error is `internal/error`, has no span, and names the form by its mangled identifier: `vendor__forma_2f686f6d652f757365722f...: Cannot call nil as function`. One variant reports `Type mismatch: Float vs Int (at offset 130)` for `(= (g 1) 2)`, where `g : Int -> Int` is imported. *File modules* says forms keep their module's helpers, but imports are evidently different. The repro is `tests/traps/hook-import/`.
- *Wish:* "Form hooks may call only helpers defined in the form's own module" (if that is the rule), with an error that names the helper and has a span.

**F2. No "author your own program" path.** The README quick start runs the repo's own tests and dev server. The file CLI (`file typecheck|evaluate|declarations`) appears only in `--help`, and that help exits with code 64. No guide says which command elaborates forms, or that `evaluate` does not typecheck.
- *Wish:* "Write `main.lisp`, then run `node packages/host/dist/cli.mjs file typecheck main.lisp` and `file evaluate main.lisp` (evaluate does **not** typecheck) and `file declarations` (elaborates forms)."

**F3. I found no documented way to get elaborated IR for a multi-file program.** `file declarations` lists the form module's `SchemaDef`/`FunctionDef` entries but none of the `vendor` payloads. `request` ops (`emit`, `artifactSummary`, ...) are listed only inside a `SchemaError` message, and nothing documents their fields.
- *Wish:* "To see a form's projected IR from files, run X."

**F5. Builtins are undocumented, and the kernel macros need a relative-path import.** `and`/`or`/`not` live in `preludes/modules/kernel.lisp`, and the error does not say which library. The SICP guide uses `or` and `not` without imports, which only works in the playground and `request` mode. I could not find a `string/` namespace or a trim function.
- *Wish:* a builtin table, and "In file modules add `(import \"<repo>/preludes/modules/kernel.lisp\" [and or not ...])`".

**F6. Hook values differ from their declared hole types.** An `(Option Int)` hole arrives as `nil` or a plain Int. *Writing a form* does say an omitted optional hole is `nil`. But `(= x nil)` then infers `Unit`, so untyped helpers cannot handle such a hole, and `match` with `Some`/`None` fails at runtime with `No pattern matched the value`.
- *Wish:* "In `:check`, optional holes are `nil` or the bare value; test with `X`."

**F7. No date or time type.** Rules 2 and 4 needed hand-picked day numbers and month-length approximations.
- *Wish:* "Forma has no date type; model dates as Int and do calendar math in the host" (or provide a `Date`).

**F8. Diagnostics often give offsets but no line or column.** Examples: `(at offset 1768)`, and the elaboration span in the bad register. Some diagnostics carry `startLine`, others don't. I computed positions with `head -c`.
- *Wish:* every diagnostic has a line and column.

**F9. A misleading Effect error from non-Effect code:** `Effect TypeScript does not support inferred open-row exports yet`.
- *Wish:* "Exported functions need closed record signatures", phrased without mentioning Effect.

**F10. Mangled identifiers leak into messages**, for example `Unbound symbol: x__forma_2f68...d78.b`. Dot access on an imported-typed binding failed at evaluation instead of typecheck.

**F11. Node version.** The default `node` in this environment is 22, and nothing failed loudly. I used `/opt/node24/bin` as the brief suggested.

### Phase 1 and Phase 2 files

**Phase 1** (the README, the guides the README links as user documentation, and CLI output):
- `README.md`
- `docs/language.md` (language guide)
- `docs/writing-a-form.md`
- `docs/structure-and-interpretation.md`: grep plus "Running the examples", §2.2 and §4.3
- `docs/modules.md`: first 120 lines
- `docs/domain-modeling.md`: grep, "Smart constructors" and "What the model can't express yet"
- CLI `--help` and diagnostic output

I listed `docs/` filenames but did not open vision, architecture, design-decisions or the RFCs.

**Phase 2:** I opened no example or fixture files. I imported `preludes/modules/kernel.lisp` by path without reading it, because *File modules* names it as the library to import. No implementation source was read.

## Silent traps (things that passed but were wrong or surprising)

- **T1. `file evaluate` skips typechecking.** It returns `ok:true` and a value for code that `file typecheck` rejects, such as `(= :high "high")`. A test suite run only through `evaluate` can be "green" and ill-typed. Mine was green under evaluate for 2 iterations while typecheck failed.
- **T2. Generic functions are instantiated once across top-level defines.** `(: same (-> a a Bool))` then `(define a (same 1 1)) (define b (same "a" "b"))` is rejected, while `[(same 1 1) (same "a" "b")]` as a final expression is accepted. The docs promise Hindley–Milner inference.
- **T3. Implicit `Some`/`None` filling works only for record types declared in the same file.** The same record checked against an imported type fails. A local copy of the type passes.
- **T4. Only the first form diagnostic is reported.** `register-bad.lisp` has 3 vendors that each violate a rule, but only one error comes back. An author would fix one error and discover the next only on the following run.
- **T5. Hook holes are not Option-typed at runtime** (F6). `match` on `Some` fails only at elaboration.
- **T6. Boolean and equality behaviour:** `(= :high "high")` is false at runtime but a type error in the checker, which is good. `(= 2 2.0)` is true, as documented. The kernel `and`/`or` need an import, but `if` is always available, so I wrote `both`/`either`/`no` functions. These are not short-circuiting.
- **T7. "Must give a reason" accepts whitespace.** No documented trim exists, so `" "` passes as a reason.
- **T8. "Not applicable" handling is a design choice the tests pin.** A vendor that processes personal data but has `touches-customer-data false` still requires review. A vendor that touches no customer data has no blockers, even with no review on file.
- **Expiry boundaries** are pinned: day 364 is current, day 365 is expired, a future-dated review is invalid, and an exception is valid at day 181 and expired at day 182.

## Draft AUTHORING.md outline

1. **What you can build**: evaluated programs, form-based languages (elaborated), and Effect TypeScript generation, with one sentence each on which command applies.
2. **Setup**: Node 24 check, install, build `ts` and `host`, a `forma` alias for `node packages/host/dist/cli.mjs`.
3. **Your first file**: `file typecheck`, then `file evaluate`, with a warning that evaluate does not typecheck. Exit codes and the JSON output shape (`value.result.printed`, `diagnostics[].span`).
4. **Imports for file modules**: the kernel prelude path, and which names (`and`, `or`, `not`, `when`, `cond`, `->`) live there.
5. **Builtins reference**: lists, strings, maps, numbers and equality, marking which ones the checker accepts (`conj`/`concat` are not accepted).
6. **Records and Option across modules**: when implicit `Some`/`None` applies.
7. **Polymorphism rules**: top-level generalization limits, with a workaround.
8. **Writing tests**: the "evaluate to the list of failures" pattern, plus a mutation check. Always typecheck first.
9. **Writing a form for authors**: hole runtime values (`nil` versus `Option`), which helpers a `:check` may call, closed signatures for exports, getting all diagnostics, and getting the projected IR from files.
10. **Modelling time**: there is no date type yet. Recommend a pattern.
11. **Reading diagnostics**: codes, spans, mangled names, and `internal/error`.
12. **Known gaps**: a link to the domain-modeling "can't express yet" list.

## Fix status

Work on branch `claude/forma-authoring-fixes`. Each fix is pinned by a
conformance fixture or host test, and the matching runner line now asserts the
corrected behaviour (`FIXED ...`). Status is **fixed** (behaviour changed),
**documented** (behaviour kept and written down), or **deferred** (not done,
with the reason).

### Findings

| Item | Status | What changed / why |
| --- | --- | --- |
| F1. Layers diverge on imported code | Fixed | The umbrella for T2, T3 and F4; each is fixed below. |
| F2. No authoring path | Documented | New [Authoring your own program](../../docs/authoring.md) page, built from the draft outline below. It is linked from the README, the docs sidebar and `llms.txt`. |
| F3. Form IR missing from `file declarations` | Fixed | `file declarations` appends one `FormApplication` entry per form application, with `form`, `name`, `moduleId`, the span and the IR as plain JSON `payload`. The runner checks all four vendors. |
| F4. Imported helpers fail in `:check` | Fixed | There were two causes. (1) Hook holes were bound with `Env.bind`, which copies the innermost frame. In a linked module that frame is the mutable slot of the last imported binding, so the hook saw its initial `nil`. Only the last name in an `import` list failed, which is why `or` and inner `fn` looked like the trigger. Holes are now bound in a fresh frame. (2) The `Float vs Int` error came from `k` in the same module: `((fn [y] (+ y 1)) x)` widened `y` to `Float` before seeing `x`. An immediately applied `fn` now types like `let` (except when an argument is itself a lambda). This changed one stored expectation, `inline-application-success`, from `Float` to `Int`, because `((fn [x] (+ x 1)) 41)` adds two Ints. Pinned by `conformance/compile-time-modules/hook-imports`. The register's `:check` now calls the policy's `activation-blockers` directly. |
| F4/F10. `internal/error`, no span, mangled names | Fixed | A hook that fails while running reports `elaborate/hook-failed` at the form application, naming the helper and its location, for example `Cannot call Int as function (in bad, helpers.lisp line 1, column …)`. |
| F5. Builtins and kernel import | Fixed + documented | `module/unimported-sugar` names `preludes/modules/kernel.lisp` and its exports. The guide has a builtins table, generated by probing the checker, that separates checked builtins from evaluate-only ones. A `trim` builtin exists; there is no `string/` namespace. In a file with `import`/`export`, a bare `not` still reports `Unbound variable: not` (deferred, see below). |
| F6. Hook hole values | Documented | This is intentional: hooks receive plain runtime values (`nil` or the bare value). It is now stated in *Writing a form* and the guide, with the `(= (get h :x) nil)` test. |
| F7. No date type | Documented | Added to the domain-modeling gaps and to the guide's "Modelling time" section. A `Date` type is deferred: it is a language feature, not a fix. |
| F8. Offsets without line/column | Fixed | At the JSON boundary (`request`, `daemon`, `file`), every located diagnostic gets 1-based `startLine`, `startColumn`, `endLine` and `endColumn`, and `(at offset N)` in messages becomes `(at line L, column C)`. The ABI span schema keeps these fields. Diagnostics returned by the in-process TypeScript API are unchanged (deferred). |
| F9. Effect wording for non-Effect code | Fixed | Now `module/unrepresentable-signature`, located at the definition and worded for any program: `p has an inferred open record type, which declarations and generated code cannot represent yet. Give it a signature whose records list every field, ...`. |
| F10. `Unbound symbol: x__forma_<hex>.b` | Fixed | Field access on a resolved module value is lowered to record access even when its definition is expanded in another batch. Messages and IR use the author's names. `SchemaDef`/`FunctionDef` names in `file declarations` remain resolved names, because they key code generation (documented). |
| F11. Node version | Fixed | Root `package.json` declares `engines.node >=24`, so pnpm prints `Unsupported engine` on Node 22. It is a warning, not a failure: `engine-strict` would also block tooling that only reads the repository. |
| `--help` exits 64 | Fixed | `help`, `--help` and `-h` print usage to stdout and exit 0. Unknown commands still exit 64. File commands exit 1 when `ok` is false. |

### Silent traps

| Trap | Status | What changed / why |
| --- | --- | --- |
| T1. `file evaluate` skips typechecking | Fixed | `file evaluate` typechecks first and returns the typecheck response when it fails. `--unchecked` keeps the old behaviour on request. The CLI's behaviour change is recorded as breaking in a changeset. |
| T2. Generic fn instantiated once across defines | Fixed | Consecutive top-level defines were typed as one recursive group. They are now split into strongly connected components and generalized in dependency order. Pinned by `generic-across-defines-success` and `generic-signature-across-defines-success`. `policy-test.lisp` uses one generic `is`. |
| T3. Implicit `Some`/`None` only for local record types | Fixed | Coercion sees other modules' type declarations during module checking and module evaluation. Pinned by `conformance/modules/imported-records`. |
| T4. Only the first form error reported | Fixed | Each application reports all its `:check` errors, and errors are collected across the module's applications. `ModuleError` carries them all. The bad register now reports 3. |
| T5. Hook holes not Option-typed | Documented | Same as F6. |
| T6. Boolean/equality behaviour | Documented | `=` behaviour is intentional and unchanged. The trial now imports the short-circuiting kernel `and`/`or`/`not` instead of `both`/`either`/`no`, which F4 had made necessary. |
| T7. Whitespace reason accepted | Fixed in the trial | The `trim` builtin exists (now in the builtins table). `exception-valid?` trims the reason, and a new case pins `"  "` as invalid. The register now records `:exception-reason`. |
| T8. Not-applicable handling | No change | This is a design choice of the trial's policy, pinned by its tests. |
| Expiry boundaries | No change | Still pinned (364/365, 181/182). |

### Deferred

- **`not` in modules.** In a file with `import` or `export`, `not` reports `Unbound variable: not`, while an import-free file gets it as a builtin. Adding `not` to the `module/unimported-sugar` check would break `not` in import-free files, so the inconsistency is documented instead.
- **Builtins the checker does not type** (`reduce`, `conj`, list `concat`, `some`, `every?`, `upper`, the predicates, ...). They are listed as evaluate-only. Typing them is checker work beyond this pass.
- **Numeric inference.** Unannotated arithmetic still infers `Float`. The guide says to give numeric helpers `Int` signatures.
- **Line/column in the in-process API.** Only the JSON boundary fills these fields today.
- **Site test `/email embeds a live compiler`.** It times out in this container. It fails identically with the base commit's engine sources, and the email example compiles to 0 errors (and 1 after "Introduce error") when run directly, so it is environmental here. The other 8 site tests pass, run against the preinstalled Chromium.

### Final `pnpm check`

`pnpm check` exits 0:

```text
Branding check passed.
@formalang/ts:test:              Tests  1078 passed (1078)
@formalang/host:test:            Tests  132 passed (132)
@formalang/website:test:         Tests  94 passed (94)
@formalang/language-server:test: Tests  13 passed (13)
@formalang/editor:test:          Tests  2 passed (2)
ℹ tests 7  ℹ pass 7  ℹ fail 0   (node test suites, twice)
Surfaces pass: 249 comparisons, 0 failures, 0 runner failures.
Prelude docs pass: 133 form docstrings, 133 checked examples; protocol preludes exempt.
llms.txt structure, source, and link targets checked in /home/user/forma/dist-docs.
```

### Final trial runner

```text
ok   policy typechecks
ok   policy tests typecheck
ok   policy tests: no failing cases
ok   mutant suite reports the flipped case
ok   register elaborates without diagnostics
ok   bad register is rejected with vendor/active-without-review
ok   FIXED T1: `file evaluate` typechecks first and refuses an ill-typed program
ok   FIXED T4: bad register reports all 3 violations
ok   FIXED T2: generic fn used in two top-level defines typechecks
ok   FIXED T3: implicit Some-wrapping works for an imported record type
ok   FIXED F10: dot access on an imported-typed binding evaluates, with Some/None filled
ok   FIXED F4: imported fns (inner lambda, Int arithmetic) are callable from a form :check
ok   FIXED F3: register's own vendor IR is listed by `file declarations`
ok   FIXED F8: every diagnostic carries a line and column

all passed
```
