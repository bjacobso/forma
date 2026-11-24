# Flagship agent-authoring example

A runnable incident-response policy automation host built solely on
`@forma-language/forma` (no `effect` imports and no workspace-relative imports).

It exercises the end-to-end Forma agent-authoring loop:

1. **Domain vocabulary & discovery**: loads [`prelude.lisp`](./prelude.lisp)
   (defining the typed `playbook` form with `:check` validation and `PlaybookIR`)
   and [`policy.lisp`](./policy.lisp) (pure typed helpers), then inspects
   `describe()` and validates IR via `emit()`.
2. **Pre-execution capability inspection**: checks an agent-authored policy
   program, inspects its `CapabilityManifest` (SHA-256 source/prelude digests
   and reachable typed capabilities), and proves an ungranted capability
   (`delete-cluster`) is rejected at `stage: "grant"` with `0` live host calls.
3. **Isolated execution under budgets & approval**: runs accepted programs
   inside `node:worker_threads` ([`worker.mjs`](./worker.mjs)) under explicit
   `steps`, `timeoutMs`, and `hostCalls` limits (plus a parent `killAfterMs`
   termination backstop) with an `onHostCall` approval hook inspecting author
   `span` offsets.
4. **Host-call journal record & deterministic replay**: records a
   `forma-journal/v1` JSONL journal during a live run, replays it
   deterministically with `0` live host calls, and verifies both
   `journal/program-mismatch` and `journal/diverged` when the program is mutated.

## Running

From the repository root, test against the packed `@forma-language/forma` tarball:

```sh
pnpm check:examples
```

Or install a local tarball directly inside this directory:

```sh
npm install /path/to/forma-language-forma.tgz effect@4.1.1
npm test
npm start
```
