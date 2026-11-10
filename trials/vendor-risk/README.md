# Vendor risk trial

Cold-author trial of Forma against the vendor-risk brief. See [REPORT.md](REPORT.md).

- `src/policy.forma`: typed policy functions (evaluate)
- `src/register-forms.forma`, `src/register.forma`: the `vendor` form, whose `:check` calls the policy, and a synthetic register (elaborate)
- `tests/policy-test.forma`, `tests/fixtures/`, `tests/traps/`, `tests/run.mjs`

Run: `PATH=/opt/node24/bin:$PATH node trials/vendor-risk/tests/run.mjs` after building `@formalang/ts` and `@formalang/host`.

## SQLite scheme-cache experiment

`cache-trial.ts` and `cache-trial.test.ts` are a bounded experiment, not a
production cache API, a storage RFC, or a WorldVM integration. No Triplex or new
dependency is involved. Run from the repository root with Node 24 and pnpm 10.20:

```sh
pnpm exec vitest run trials/vendor-risk/cache-trial.test.ts --reporter=verbose --disableConsoleIntercept
```

The tests create real SQLite files under the OS temporary directory and remove
them afterwards. Existing Forma fixtures are never rewritten. The fresh-process
test uses Node's experimental type transformation to load compiler source; Node
24 also emits an experimental warning for its built-in SQLite API.

### What is reused

The existing register → forms → policy → kernel import graph is resolved and
expanded normally. Only the pure policy module's HM definition bodies are
eligible. The experiment uses the compiler's actual SCC grouping within each
consecutive definition run, hashes each lowered definition (including its
signature), and stores one scheme batch per component. Recursive members are
never reused independently. Definitions retain Forma's resolved nominal names;
the hashes do not promise Unison-style rename or file-move independence.

Scheme payloads are JSON trees with quantified type/row/effect variables renamed
out of the checker's fresh-variable namespace. Open schemes, typeclass
constraints, warnings, deferred constraints, non-definition/type policy forms,
and runtime imports into policy are outside this trial's contract.

Each check key includes **every supplied source's exact hash**, the component
hash, the actual compiler-source/dependency-lock/trial-code fingerprint, checker
namespace, Node version, batch/editor mode, and ordered prelude manifest. This
conservative dependency superset covers private helpers, contracts, evaluated
data, form hooks and graph-wide context types without pretending to track their
minimal read sets. Even whitespace and unrelated edits invalidate schemes.
Structural definition hashes ignore node IDs and locations; cache keys do not.
Prelude-manifest order and compiler/checker upgrade cases test key sensitivity;
they do not load a different compiler or implement a prelude-selection API.
Host callbacks and alternate builtin/type policies are not supported.

Each successful invocation compares **all candidate policy schemes** against an
independently reconstructed, uncached `checkModuleGraph` result before writing
new entries. Elaboration IR and authored spans are compared across fresh graph
resolutions too. Macros, form checks/projections, type declarations, and full
graph/mechanics validation still run; checker WeakMaps, editor typed spans and
session validation brands are not persisted. This intentionally pays for a clean
oracle on every run and is not a full-pipeline caching implementation.

### Observed results

The baseline has 14 eligible definitions/components. A cold process reports
`hits=0, misses=14, inferredBodies=14`; a second fresh Node process reading the
same SQLite file reports `hits=14, misses=0, inferredBodies=0` for the **trial HM
pass**, with schemes matching clean inference. The clean oracle still checks
the entire graph, including those bodies. No speedup is claimed or benchmarked.

The nine acceptance tests cover source/layout changes, unrelated definitions,
dependency types, same-signature private helpers, consumed data, macros, form
projections, declaration data, checker/compiler namespaces, editor mode, prelude
manifest ordering, graph-wide context types and effect contracts. They also
exercise recursive-group invalidation, polymorphic type/row schemes, mixed
hits/misses, changed IR values, relocated error spans, new type/form errors and
a deliberately poisoned scheme. Failures do not add cache entries.

The SQLite file contains disposable `checks`, immutable `releases` (source
bundles, options and parent identity), and mutable `refs`. After promoting a new
release, deleting **all** checks, and reopening the file, the test reloads the
old release, reproduces its schemes/IR, and executes its 365-day rule. The newer
release still executes 366 days. Thus release retention is independent of cache
retention. Source snapshots are stored whole, not deduplicated into a complete
definition-object graph.

This proves local persistence and historical source lookup using the current
compiler/runtime, not preservation of an old executable toolchain, runtime fact
history, external-effect evidence, concurrent publishers, migrations, crash
durability, or WorldVM replay. Those remain host concerns. The next useful
experiment is tracked dependency reads with an unrelated-edit cache-hit control;
only then is it useful to measure authoring latency or design a production API.
