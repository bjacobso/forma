# effect-go (prototype)

A prototype for [RFC 0019](../../docs/rfcs/0019-effect-go.md): a Go port of
the semantic core of Effect (effect@4.0.3) and a Forma → Go generator that
reuses Forma's existing mechanics checker. It is **not a supported Forma
target**. It is not published, not part of `pnpm check`, and its APIs will
change.

## Run the demo

Requirements: the repository set up as in [AGENTS.md](../../AGENTS.md) and Go
1.25 or later on `PATH` (the runtime tests use `testing/synctest`, stable in
Go 1.25). The demo installs nothing.

```sh
pnpm effect-go:demo
```

It builds `@formalang/ts`, then:

1. generates Go from four Effect conformance programs
   (`conformance/effect-typescript/cases/{crud-users,operational-effects,concurrent-workflow,resource-scope}/program.lisp`)
   into a temporary directory, and reports whether each output matches the
   committed golden;
2. prints one operation as Forma and as generated Go;
3. runs `go vet`, the runtime tests, and the Go twins of the TypeScript
   harnesses with `-race`, building the freshly generated files through
   `go -overlay`;
4. runs `cmd/demo`, which drives the generated packages.

Without the demo script:

```sh
cd prototypes/effect-go
go test -race ./...                              # runtime, helpers, conformance
go run ./cmd/demo                                # the generated programs
go test -run '^$' -bench . -benchmem ./bench/    # benchmarks
node bench/effect-ts.mjs                         # the same workloads on Effect-TS
```

## Layout

| Path | Contents |
| --- | --- |
| `effect/` | The runtime: `Effect[A]` opcodes and interpreter, goroutine-backed fibers, `Exit`/`Cause`, `Gen`/`Await`, fork/join, interruption and supervision, `Scope`, `Layer`/`Context`/`Provide`, `FiberRef`, `Clock` and `TestClock`, `Schedule` with `Retry`/`Repeat`, `Race`/`Timeout`/`ForEach`/`All`, `Ref`, `Deferred`, `Queue`, `Semaphore`, `PubSub`, `Blocking`/`Detached`. |
| `effect/*_test.go` | Runtime tests. `interruption_test.go` ports scenarios from Effect's interruption suite; `scope_test.go` pins finalizer order on success, failure, and interruption. |
| `forma/` | Value helpers generated code calls, with the Effect TypeScript target's semantics: JavaScript-ordered maps, JavaScript `trim`/length/upcase, safe-range `Int` arithmetic, JavaScript number formatting. |
| `conformance/<case>/program.go` | Generated Go. These are goldens, pinned by `packages/ts/test/effect-go.test.ts`, which runs in `pnpm check` without Go. Regenerate with `FORMA_UPDATE_GOLDEN=1 pnpm --filter @formalang/ts exec vitest run test/effect-go.test.ts`. |
| `conformance/<case>/harness_test.go` | Hand-written Go twin of the case's `harness.ts`: the same calls and assertions. |
| `bench/` | Benchmarks against plain Go, and `effect-ts.mjs` with the same workloads on Effect-TS. `bench/pure/` is generated from `bench/pure/program.lisp`. |
| `cmd/demo/` | A command that runs the generated programs. |
| `scripts/demo.mjs` | The end-to-end demo. |

The generator is `packages/ts/src/mechanics/effect-go.ts`, exposed as the
isolated entry point `@formalang/ts/effect-go` (`generateEffectGoProgram`).

## Limits

- The generator translates the subset used by six of the thirteen positive
  Effect conformance programs (four of which have Go harnesses). Tagged and
  structural unions, streams, `config`, `decode`, `result`, generic
  functions, and `catch` with a catch-all arm are reported as
  `effect-go/unsupported`.
- No decoders: schemas become Go types without validation.
- Layers in `MergeAll` are built sequentially; Effect builds them
  concurrently.
- `Semaphore` is not fair, and multi-permit acquisition can starve.
- `Stream` and `STM` are not ported.

See the RFC for measured results and the semantic decisions.
