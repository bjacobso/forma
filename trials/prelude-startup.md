# Prelude snapshots and CLI cold start

Recorded 2026-11-11 in a Linux x64 Amp orb, Node 24.14.1, pnpm 10.20.0.
Fifteen pairs of fresh Node processes per workload, alternating execution
order; medians include process startup and module imports, not a warm daemon.
Output equality is asserted for every sample. The disk cache is primed once;
the initial miss is measured separately.

| Workload | Baseline median | Optimized median | Reduction | Initial miss |
| --- | ---: | ---: | ---: | ---: |
| Single-file CLI typecheck importing `kernel.forma` | 368.0 ms | 343.3 ms | 6.7% | 357.1 ms |
| Bundled ontology descriptor bootstrap | 497.1 ms | 339.1 ms | 31.8% | 496.9 ms |

The file baseline is the CLI transport from main commit `3e34660`, compiled
to ESM and linked to the same engine build/dependencies as the optimized CLI.
The optimization reuses the already-resolved graph for module typechecking
and loads the JSON ABI only when needed. The descriptor baseline is the same
SDK build with `FORMA_NO_CACHE=1`. These isolate changes without conflating
dependency upgrades. In an earlier same-build comparison, macro snapshots alone
did not improve file latency outside measurement noise: most of the file gain
comes from avoiding repeated graph work. This is not a universal startup SLA.

## Reproduce and guard

After building the engine and host:

```sh
node scripts/bench-prelude-startup.mjs --check
```

The script creates and removes its own fixture and cache directories. It
compares cache-disabled and cache-enabled fresh processes. CI runs this after
`pnpm check`: descriptor bootstrap must improve by at least 10%; file startup
must not regress by 10% or more, allowing for process/import noise. To compare
CLI revisions, pass `--baseline-cli <built-baseline-cli.mjs>`; that baseline must
be runnable with its dependencies and emit the same JSON responses.

## Deliberate boundaries

Snapshots contain validated descriptor data, kernel macro environments, and
closed import-free macro-library environments. Hooks are reconstructed from
this build. Host builtin factories, deferred validation, mutable sessions,
arbitrary module imports and runtime values are not cached. The Node/V8 format
preserves cyclic lexical closures and Map/Set identity; it does not serialize
JavaScript functions. Engine source/build configuration/lockfile content,
source text and identity, Node/V8 version, and the native-elaboration setting
invalidate keys. Files are private and atomically replaced; corruption or an
unwritable cache falls back to ordinary compilation.

This does not adopt the SQLite definition-cache trial or decide package/bin
ownership. RFC 0025 remains the packaging decision.

## Correctness evidence

- The SDK tests were run failing before `checkPrelude` existed.
- Main's CLI fails the snapshot regression because it writes no cache.
- Cached/uncached `file typecheck`, `evaluate`, and `declarations` agree.
- Editing an imported macro invalidates its snapshot and changes the result.
- Corrupt snapshots recover; warm hits do not rewrite the stored files.
- Ontology elaboration agrees after descriptor restoration, and mutations to
  one returned registry do not leak into the next bootstrap.
- Direct file typechecks match session ABI responses for imported polymorphic
  values and negative typechecks, including author diagnostic locations.
- An external consumer prelude checks its forms, docstrings, examples,
  diagnostic catalog and generated Markdown using only public SDK/CLI APIs.
