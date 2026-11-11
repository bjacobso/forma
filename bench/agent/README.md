# Cold-agent benchmark

Twenty tasks measure whether a cold coding agent can author checked Forma.
The `core` tier preserves the original twelve tasks: four kernel programs,
four library consumers, and four module-defined forms (including vendor risk).
The `hard` tier adds eight integration tasks targeting 20–60 minutes each.
The original real-agent baseline passed 12/12 core tasks with a median of zero
repairs (gpt-6.1-sol, revision bb59a29); compare core separately when measuring
progress. Hard-task times are design estimates, not measured agent baselines;
run a cold real agent to establish their solve rate and calibrate difficulty.
No model SDK, API call, or agent dependency is part of this repository.
Use Node 24 and the installed pnpm 10.20 dependencies. Rebuild first:

```sh
pnpm --filter @formalang/ts build && pnpm --filter @formalang/host build
pnpm bench:validate
node bench/agent/run.mjs --tier hard --agent-cmd 'codex exec --full-auto "$(cat brief.md)"' --out hard-results.json
node bench/agent/run.mjs --agent-cmd 'codex exec --full-auto "$(cat brief.md)"' --out results.json
node bench/agent/run.mjs --agent-cmd 'claude -p "$(cat brief.md)"' --tasks tiered-price,spend-limit --out results.json
```

Agent commands are shell commands supplied by the operator. Install and
authenticate your chosen agent yourself. Run the benchmark with a cold agent
session, no inherited chat context, and sandbox permissions appropriate for
your agent. The harness creates a clean temporary working directory, not an OS
security boundary: an unrestricted agent can still read the repository. The
wrapper uses the repository's absolute built CLI path. It does not copy engine
source, reference solutions, or acceptance checks into the working directory.
Existing context libraries keep their original extensions; authored Forma
sources and references use `.lisp`. The embedding task also authors a Node script.

Each directory receives `brief.md`, only the files listed in `context.json`,
and `bin/forma`. PATH includes that bin directory and FORMA_TASK_DIR is the
absolute working directory. Agents should use `forma` so calls are measured.
The wrapper preserves CLI stdout, stderr, and exit status, and appends argv,
cwd, exitCode, durationMs, and diagnosticCodes to `.forma-calls.jsonl`.
Acceptance runs through the CLI separately after the command exits. A failed
agent process is recorded independently from acceptance, so a good submission
can still pass after an agent process error. Agent stdout/stderr are retained
in `agent.log`. Temporary directories remain for inspection; results list
`taskDir`. Remove them manually when no longer needed. There is no automatic
agent time limit; use your agent's limits or a shell timeout when desired.

`results.json` records each task's pass and reasons, wall time of the agent
command (excluding setup and hidden acceptance), CLI call count, repair rounds,
and first passing call index. Repair rounds count failed `file typecheck`,
`file evaluate`, or `file declarations` calls on `context.entry` before its
first passing call. Human `check`, `run`, and `test` calls targeting that same
entry now also count (including flags such as `--json`). The built CLI currently
has no `test` command; it is recognized by telemetry for CLI versions that do.
Other targets and commands do not count. The existing `file` command metric is
unchanged, so core runs using those commands remain comparable to the baseline;
for human-command runs record this metric extension when comparing old reports.
An entry that never
passes has a null firstPassingCall and counts all its failed calls. This is a
CLI repair proxy, not a count of chat turns. Deliberately checking invalid
inputs can increase it. Calls made without the wrapper cannot be measured.
Totals report pass rate as a fraction and median repair rounds across all tasks.
Each result carries `tier`; `results.json.tiers.core` and `.hard` contain the same
totals by tier, and the printed tables show task tiers and tier totals. An absent
tier has zero tasks, null pass rate, and null median. Without `--tier` all tasks
run; combine `--tier core|hard` and `--tasks a,b` to take their intersection.
An empty intersection or unknown tier is an error.
Keep result JSONs with the agent model/version/settings and commit revision
when comparing runs; the shell command alone may not identify a model version.

## Hard tasks

| Task | Stress case |
| --- | --- |
| approval-network | Five modules, imported policy helpers in hooks, multiple located errors, expiry and money boundaries |
| optional-enrollment | Nested imported Option records, omitted fields, inline arguments, fallback and aggregation |
| tagged-ledger | Closed literal unions and tagged events through polymorphic helpers and map/filter/reduce |
| effect-checkout | Errors and service requirements, recovery, generated Effect execution against test services |
| embedded-gate | Isolated facade modules, typed capability, no effects before checking, step limits and lifecycle |
| repair-dispatch | Seven seeded module, visibility, arity, name, Option, numeric, and boundary faults |
| numeric-invoice | Integer per-line tax rounding, negative credits, Float telemetry and smoothing |
| workflow-planner | Stable topological scheduling, validation precedence, projected workflow IR |

These tasks draw on the expense-rules and vendor-risk trials, the domain and
Effect guides, and the check/run numeric divergences. Hidden acceptance compares
behavior, declaration payloads, diagnostic codes and author locations; it never
matches submission source text. Effect acceptance compiles the CLI's checked
IR and runs it with in-memory services. References use explicit Int reducer
signatures to avoid known numeric widening. Workflow expressions use an inline
structural record contract because a named record alias in an Expr-list hole
currently fails elaboration; this does not weaken its pure Plan API.

## Adding a task

Create `tasks/<id>/` with:

- `brief.md`: everything the agent sees, precise public API, files to write
  (Forma source uses `.lisp`), and CLI commands. Target 5–30 minutes for core or 20–60 minutes for hard.
- `context.json`: `{ "tier": "core|hard", "kind": "kernel|prelude|form", "entry": "main.lisp",
  "files": ["docs/authoring.md", "preludes/modules/kernel.lisp"] }` with repo-relative
  context paths. Include transitive imports of any supplied library.
- `accept.mjs`: export `async function accept(outputDir)` returning
  `{pass, reasons}`. Test behavior through CLI evaluation and declarations,
  accepted/rejected inputs, and exact diagnostic codes. Do not inspect source
  text or require a particular implementation strategy. Helpers in
  `accept-support.mjs` create temporary hidden probes importing the submission.
- `reference/`: a checked implementation, with exactly the files the brief asks
  the agent to author. Do not put the reference in context.

`validate.mjs` first checks that empty submissions fail and all references pass,
then runs the real harness with a simulated agent that fails once, copies a
reference, and checks it. It verifies both acceptance and telemetry. Update
its explicit task/kind/tier counts when intentionally extending the suite.
All twenty empty submissions, references, and simulated agents are validated.
Reference checks use at most two worker processes to bound validation time.
The simulator uses the legacy file commands for core and a human check followed
by a file check for hard, pinning both telemetry paths. Harness
unit tests pin option parsing and repair-count semantics. This infrastructure
does not change Forma semantics and does not rewrite surface goldens.

## Latency tracking

```sh
pnpm bench:latency
pnpm bench:latency --out /tmp/latency.json
pnpm bench:latency --update-baseline
```

The latency script compares against `scripts/benchmarks/latency-baseline.json`.
Only `--update-baseline` replaces that reviewed baseline; normal runs write
`scripts/benchmarks/latency-results.json` (ignored). Each timing is the median
of nine runs after three warmups. Cold checks use a fresh CLI process for each
sample, with OS caches warmed; warm Engine checks repeat the same 500-definition
source. Edited checks alternate new values in one definition through
AnalysisWorkspace's setDocument/analysis editor path, including invalidation.
Dist sizes sum all regular files, including types and maps; gzip sizes sum
individually compressed files at level 9. This is package footprint, not an
application bundle size. Hardware, Node, revision, and raw samples are recorded.
CI uploads its report without enforcing a threshold. Compare equivalent
machines and toolchains before drawing conclusions from percentage changes.

### Named record aliases in expression holes

Form expression holes now resolve named record aliases inside lists, options,
and other nested type applications. The workflow task's reference retains its
inline structural contract spelling; it remains valid. Regression fixtures live
in `conformance/form-alias-records/`.
