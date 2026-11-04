# effect-go (prototype)

A prototype for [RFC 0023](../../docs/rfcs/0023-effect-go.md): a Go port of
the semantic core of Effect (ported from effect@4.0.3; the rules it ports are
unchanged in 4.1.1, which Forma now targets) and a Forma → Go generator that
reuses Forma's existing mechanics checker. It is **not a supported Forma
target**. It is not published, its Go code does not run in `pnpm check`, and its APIs will
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
   and the `http-api` prelude program into a temporary directory, and reports
   whether each output matches the committed golden;
2. prints one operation as Forma and as generated Go;
3. runs `go vet`, the runtime tests, and the Go twins of the TypeScript
   harnesses with `-race`, building the freshly generated files through
   `go -overlay`;
4. runs `conformance/http-api/cross-host.ts`: the same requests against the
   TypeScript server and the Go server generated from one program, then
   Effect's `HttpApiClient` against the Go server;
5. runs `cmd/demo`, which drives the generated packages.

Without the demo script:

```sh
cd prototypes/effect-go
go test -race ./...                              # runtime, helpers, conformance
go run ./cmd/demo                                # the generated programs
go test -run '^$' -bench . -benchmem ./bench/    # benchmarks
node bench/effect-ts.mjs                         # the same workloads on Effect-TS
../../node_modules/.bin/tsx conformance/http-api/cross-host.ts   # TypeScript ⇄ Go
```

## Layout

| Path | Contents |
| --- | --- |
| `effect/` | The runtime: `Effect[A]` opcodes and interpreter, goroutine-backed fibers, `Exit`/`Cause`, `Gen`/`Await`, fork/join, interruption and supervision, `Scope`, `Layer`/`Context`/`Provide`, `FiberRef`, `Clock` and `TestClock`, `Schedule` with `Retry`/`Repeat`, `Race`/`Timeout`/`ForEach`/`All`, `Ref`, `Deferred`, `Queue`, `Semaphore`, `PubSub`, `Blocking`/`Detached`. |
| `effect/*_test.go` | Runtime tests. `effect4_port_test.go` ports tests from Effect 4's own suite (commit recorded in the file); `interruption_test.go` adds further interruption scenarios; `scope_test.go` pins finalizer order on success, failure, and interruption. |
| `httpapi/` | The Go runtime for the `http-api` prelude on `net/http`: routing, strict request decoding, and Forma's wire encoding (Effect `HttpApi`'s responses). |
| `forma/` | Value helpers generated code calls, with the Effect TypeScript target's semantics: JavaScript-ordered maps, JavaScript `trim`/length/upcase, safe-range `Int` arithmetic, JavaScript number formatting. |
| `conformance/<case>/program.go` | Generated Go. These are goldens, pinned by `packages/ts/test/effect-go.test.ts`, which runs in `pnpm check` without Go. Regenerate with `FORMA_UPDATE_GOLDEN=1 pnpm --filter @formalang/ts exec vitest run test/effect-go.test.ts`. |
| `conformance/<case>/harness_test.go` | Hand-written Go twin of the case's `harness.ts`: the same calls and assertions. |
| `conformance/http-api/` | The `http-api` prelude program as Go (generated through the prelude's `:go` hooks), its Go harness, the shared `wire-cases.json`, and `cross-host.ts`. |
| `cmd/shop-server/` | Serves the generated `http-api` program on a free port for `cross-host.ts`. |
| `bench/` | Benchmarks against plain Go, and `effect-ts.mjs` with the same workloads on Effect-TS. `bench/pure/` is generated from `bench/pure/program.lisp`. |
| `cmd/demo/` | A command that runs the generated programs. |
| `scripts/demo.mjs` | The end-to-end demo. |

The generator is `packages/ts/src/mechanics/effect-go.ts`, exposed as the
isolated entry point `@formalang/ts/effect-go` (`generateEffectGoProgram`, and
`generateHttpApiGoProgram` for the `http-api` prelude).

## Limits

- The generator translates the subset used by six of the thirteen positive
  core Effect conformance programs (four of which have Go harnesses), plus
  the `http-api` prelude program. The Elm and email preludes have no `:go`
  hooks. Tagged and structural unions, streams, `config`, `decode`,
  `result`, generic functions, and `catch` with a catch-all arm are reported
  as `effect-go/unsupported`.
- No schema-derived decoders: `httpapi` decodes requests by reflection over
  JSON tags, and nothing else decodes.
- Layers in `MergeAll` are built sequentially; Effect builds them
  concurrently.
- `Semaphore` is not fair, and multi-permit acquisition can starve.
- `Stream` and `STM` are not ported.

See the RFC for measured results and the semantic decisions.
