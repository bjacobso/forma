# Cold-agent benchmark

Twelve tasks measure whether a cold coding agent can author checked Forma:
four kernel programs, four uses of existing file-module libraries, and four
module-defined forms with checks (including the adapted vendor-risk trial).
No model SDK, API call, or agent dependency is part of this repository.
Use Node 24 and the installed pnpm 10.20 dependencies. Rebuild first:

```sh
pnpm --filter @formalang/ts build && pnpm --filter @formalang/host build
pnpm bench:validate
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
Existing context libraries keep their original extensions; all authored task
files and references use `.lisp`.

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
first passing call; other files and commands do not count. An entry that never
passes has a null firstPassingCall and counts all its failed calls. This is a
CLI repair proxy, not a count of chat turns. Deliberately checking invalid
inputs can increase it. Calls made without the wrapper cannot be measured.
Totals report pass rate as a fraction and median repair rounds across all tasks.
Keep result JSONs with the agent model/version/settings and commit revision
when comparing runs; the shell command alone may not identify a model version.

## Adding a task

Create `tasks/<id>/` with:

- `brief.md`: everything the agent sees, precise public API, files to write
  (all `.lisp`), and CLI commands. Target 5–30 minutes of competent work.
- `context.json`: `{ "kind": "kernel|prelude|form", "entry": "main.lisp",
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
its explicit task/kind counts when intentionally extending the suite. Harness
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
