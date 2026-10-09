# Market desk: schemas, services, and layers

This example adapts a market API built with Effect into Forma. A request asks a
question; a feed supplies a market snapshot; a language model returns a structured
brief. The HTTP handler delegates to the desk service.

<a href="/playground/demo/market-desk" target="_self">Explore the source and generated TypeScript</a>, or
<a href="/playground/live/market-desk" target="_self">edit it with live checking</a>.

## From Effect to Forma

| Responsibility | Effect | Forma |
| --- | --- | --- |
| Request and response data | `Schema.Struct` | `type` with record fields |
| Typed failures | `Schema.TaggedError` | `error` |
| Service interface | `Context.Service` | `service` |
| Implementation and dependencies | `Layer.effect` and `Service.of` | `layer :provides` |
| Internal wiring | `Layer.provide` | `layer-provide` |
| Handler workflow | `Effect.gen` and `yield*` | `do!` and service calls |
| HTTP contract and routing | `HttpApiEndpoint` and `HttpApiBuilder` | TypeScript host code using generated schemas and services |

The generated code targets the repository's pinned Effect 4 version. Its HTTP
endpoint uses the options-object API. HTTP routing is hand-written; Forma's
Effect generator does not emit HTTP APIs yet.

## The Forma program

<<< ../../conformance/effect-typescript/cases/market-desk/program.lisp{lisp}

`AskBody`, `MarketSnapshot`, and `MarketBrief` describe data. `MarketApiError`
describes a failure value. None of those declarations supplies an implementation.

`MarketHttp` and `LanguageModel` are host adapter interfaces. The host implements
HTTP access and structured model generation, mapping failures into
`MarketApiError` and validating external data against the generated schemas.
This example's harness supplies deterministic adapters instead of calling a
market provider or a model API.

`MarketFeedLive` implements the feed using `MarketHttp`. `MarketDeskLive` captures
the feed and model, reads a snapshot, and passes it with the question to the
model. The feed's `snapshot` is a zero-argument Effect value; `brief` and
`generate` are methods with arguments.

`AppLive` provides the feed implementation to the desk implementation. Its checked
type exposes `MarketDesk` and still requires `MarketHttp` and `LanguageModel`.
The host supplies those two adapters. Errors occur when the methods run, so the
layer's construction error set is empty.

`ask-market` reads the request and runs the desk through `AppLive`. Removing
`LanguageModel` from its declared requirements produces a diagnostic against the
Forma source and blocks generation. Try the broken variant in the live workbench.

## Generated Effect TypeScript

This is the exact generated module checked by the conformance suite:

<<< ../../conformance/effect-typescript/cases/market-desk/expected.ts{ts}

## HTTP contract and handlers

The TypeScript host reuses the generated request and response schemas, tagged
error, and desk service. The endpoint accepts `POST /market/ask`, returns a brief
with status 200, and encodes adapter failures with status 502.

<<< ../../conformance/effect-typescript/cases/market-desk/http.ts{ts}

`makeMarketApi` wires the handlers to the generated desk layer and the supplied
adapters. An HTTP router can serve that layer; the conformance harness uses
`HttpRouter.toWebHandler` to exercise it without a listening server.

The executable checks verify the question and snapshot reaching the model,
the returned brief, feed and model failure propagation, request validation before
adapter execution, and the encoded HTTP success and error responses.
