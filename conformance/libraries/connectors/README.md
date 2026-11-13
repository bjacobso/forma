# LX2 investigation: connectors as a file library

Status: stopped at the import investigation, as permitted by the LX2 brief.
This fixture is not yet an importable library. There is no JSON adapter or
output-neutral linker implementation in this change.

## Import of file libraries

**A plain file can already export descriptor `form` definitions.** No new
selection mechanism is needed for simple forms. `modules/compile-time.ts`
retains the defining module's descriptors, private helper closures and type
metadata; `discoverFormDeclarations` introduces an importer's `Declares` names.
The first investigation test checks a named import through `checkModuleGraph`
and reads its elaborated declaration.

The complete WorldVM family needs more than selecting an existing descriptor:

1. File modules reject qualified local declaration names. The original family
   first fails on `machine-child/state`; it also contains
   `machine-child/transition` and `machine/check`.
2. Renaming only those three private names exposes a second failure:
   `owns[0] must be undefined`. In `surface/form.ts`, linked validation tests
   only the outer hole type for `syntaxHole`; `Option (List (Refers MachineDef))`
   therefore reaches `contractErrors`. That value-contract checker has no
   `Refers` case. Reference validation needs to retain its separate semantic
   check rather than simply accepting arbitrary values.
3. Omitting `:owns` in a separate probe exposes `Unbound symbol: state`.
   `modules/compile-time.ts`'s `evaluateHole` treats the child family as an
   executable expression. `surface/form.ts` initially converts holes before
   elaborating children. A linked child-family hole needs descriptor-aware
   dispatch before ordinary evaluation.

The latter probes transform an in-memory copy only. The checked-in library
preserves the original prelude, preceded by `(export connector machine)` and
its five required core helpers (`same?` is a dependency of `member?`). The tests
record current limitations; they are not the desired language contract.

Further work must reconcile module identities with child descriptor lookup:
WorldVM's family lookup uses `family/child`, whereas file-module descriptors
have resolved identities. Linked child hooks also currently recurse without the
linked evaluation context. Helper preparation and diagnostics must be checked
through that path before claiming parity. Those are observations from code
inspection, not additional reproduced failures.

This crosses module naming/resolution, syntax-hole validation and linked child
execution. Rather than add a partial special case for connectors, this work
stops at the brief's investigation boundary. No compiler behavior changed.

The fixture lives under `conformance/libraries/connectors` because it is a
read-only experimental language input, with no shipped prelude, bundled
specifier or package export. The probes are in
`packages/ts/test/connectors-import-investigation.test.ts`.

## Fixture parity

Parity has **not** been established. The exact WorldVM oracles in
`.context/lx2-fixtures/{connectors,bad-state}.worldvm.json` were read without
modification. No output was generated or normalized. Resolution fails before
emission, so there are no measured output-field differences to report.

The original passing source, followed by a library import, fails the qualified
local-name gate. Appending an import rather than prepending it preserves the
oracle's authored offsets and line/column positions. A future parity test must
use source IDs `connectors.lisp` and `bad-state.lisp` and compare the complete
`connectors` and `machines` arrays, including `at`, and the two failing
case diagnostics. It must also test absent `doc` omission independently: the
provided passing fixture documents every declaration.

Plain `forma check` acceptance, the two `E_MACHINE_STATE` locations, JSON
emission, and graph edges are not implemented or verified. Existing linked
form checks preserve a hook's explicit code, so the proposed choice is to keep
`E_MACHINE_STATE` unchanged, rather than introduce an adapter namespace. This
must still be verified once the family can elaborate; no new diagnostic code
has been added to the engine.

## Adapter interface

No adapter was forced through TypeScript emission, and no existing Effect
extension was refactored. Inspection of LX1's internal interfaces identifies
these constraints:

- `EffectExtension.prelude` is a bundled `PreludeName`, not a file-module
  identity. `forms` names strings rather than resolved form identities.
- `imports` and `EmittedExport.code`, names and references describe TypeScript
  expressions and their imports. They have no useful role in a JSON document.
- `prepare` returns ordinary Effect syntax. A data adapter's lowering should
  return its own typed IR, without making fake mechanics declarations.
- `check`, `emit` and `graph` require `MechanicsContext`. Its `check`,
  `mechanics` and generated `exports` are unnecessary for connectors;
  `importedDeclarations` is useful in principle, but is restricted to the
  current elaborated declaration representation. Common context fields such
  as source identity, locations and diagnostic reporting remain useful.
- `LinkOptions.sourceId` and `namespace` remain meaningful;
  `schemasFrom` is a TypeScript module concern.
- `LinkedEffectSystem.code` and `modules` require TypeScript strings/modules;
  `declarations` requires packageable declarations. `ok`, `diagnostics` and
  the nodes/edges structure can remain common. A JSON result needs a typed
  output/artifact slot, independent of `code`.

Proposed internal split (not implemented):

```ts
interface LibraryAdapter<IR> {
  prelude: ModuleIdentity;
  forms: readonly BindingIdentity[];
  check(context: LibraryContext): readonly Diagnostic[];
  lower(context: LibraryContext): readonly IR[];
  graph(ir: readonly IR[], context: LibraryContext): SystemGraph;
}
interface Backend<IR, Output> {
  emit(ir: readonly IR[], context: LibraryContext): Output;
}
interface Linked<Output> {
  ok: boolean;
  diagnostics: readonly Diagnostic[];
  output?: Output;
  system?: SystemGraph;
}
```

`LibraryContext` supplies resolved authored declarations, dependency identities,
source lookup and locations. Mechanics checking is an explicit capability for
Effect adapters. The TypeScript backend owns imports, export names, collision
handling, expression code and output paths. A JSON backend owns document
assembly and omission rules. The connectors graph should contain connector,
machine and machine-qualified state nodes, `owns` edges, `signals` edges from a
machine to its listening connector, and state-to-state `transition` edges.

Moving RPC, HTTP API and Cluster onto that contract should follow working
file-library elaboration and exact data parity. Doing it in this investigation
would expand scope and would not establish the missing import semantics.

No goldens changed. No changeset: only a fixture and investigation tests were
added; public behavior is unchanged. No commits or sibling-repository edits.

Verification commands run for this investigation:

| Command | Result |
| --- | --- |
| `pnpm --filter @formalang/ts test test/connectors-adapter.test.ts` (temporary probe, three runs) | Failed success assertions in sequence: `Module declaration machine-child/state must be an unqualified name.`, `owns[0] must be undefined`, `Unbound symbol: state`. Replaced by explicit investigation probes. |
| `pnpm --filter @formalang/ts test test/connectors-import-investigation.test.ts` | Passed, 4 probes. |
| `pnpm --filter @formalang/ts test test/connectors-import-investigation.test.ts test/compile-time-modules.test.ts test/effect-imports.test.ts` | Passed, 31 tests. |
| `ALCHEMY_HOME=$(mktemp -d) pnpm check` | Failed: engine 1,520 passed, 2 skipped; host 289 passed, 19 failed in `test/invalid-source.test.ts` with `SyntaxError: Unexpected end of JSON input`. Final tail: `Failed: @formalang/host#test`, `ERROR run failed: command exited (1)`, `ELIFECYCLE Command failed with exit code 1.` Later checks, including surface comparison and docs build, were not reached. |
| `pnpm check:changesets` | Passed. |
| `pnpm --filter @formalang/ts build` then `pnpm --filter @formalang/host build` | Both passed. |
| `node packages/host/dist/cli.mjs check /tmp/forma-lx2-import-probe/connectors.lisp` | Failed as expected: `error[module/declaration-name]: Module declaration machine-child/state must be an unqualified name.`, at `library.lisp:34:7`; `1 errors, 0 warnings`. Temporary input appends the import to the unchanged passing oracle source. |
| `node packages/host/dist/cli.mjs check /tmp/forma-lx2-simple-probe/main.lisp` | Passed: `0 errors, 0 warnings`; a minimal exported descriptor form imported from `./library.lisp`. |
| `git diff --check` | Passed. |

`pack:check`, `check:examples` and `check:tarball` were not run: this stopped
investigation changes no packaged behavior. No network or install commands
were run. The full-check log is `/tmp/lx2-check.log`; the changeset log is
`/tmp/lx2-changesets.log`.

The isolated rerun `pnpm --filter @formalang/host test test/invalid-source.test.ts`
passed all 96 tests after rebuilding. The initial full-check failure may have
been caused by overlapping that rebuild with host CLI subprocesses; it is not
classified as a baseline or sandbox failure. A final full check was run
without concurrent builds (log `/tmp/lx2-check-final.log`). A Python suffix
comparison also confirmed that the checked-in fixture retains the complete
WorldVM connectors prelude verbatim.

Final `ALCHEMY_HOME=$(mktemp -d) pnpm check`: **passed** (exit 0).
This includes 1,520 engine tests, 308 host tests, 249 surface comparisons,
docs, and 20/20 benchmark references plus 20/20 simulated agents. The earlier
failure remains recorded above; the final run supersedes it. No stored golden
was rewritten.

Open scope question for the next work package: define descriptor-aware lexical
child dispatch and recursive syntax-hole validation before introducing the
output-neutral linker/backend split. No design choice was silently made here
for those missing semantics.

## LX2a phase 2 update

The historical investigation above is retained with the restored fixture.
The engine now resolves and elaborates this unchanged library, including nested
references and child projections. The converted success tests expose a further
checking boundary: `checkModuleGraph` reports `Unbound variable: nil?` in
`name-of`. The builtin inventory explicitly marks several helpers used here
(`nil?`, `some`, `flat-map`, `get`) as lacking ordinary HM schemes. Plain checking
acceptance remains blocked pending a scope decision; no builtin typing policy
or adapter behavior was added to conceal that failure.
