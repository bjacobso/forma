# Prelude-defined RPC

`preludes/rpc.lisp` defines unary RPC contracts and named groups for
**Effect 4.1.1**. It is an ordinary declaration prelude: its `:emit` hooks
produce native `Rpc.make` and `RpcGroup.make` expressions. There are no
RPC-specific cases in the mechanics compiler and no generated execution kernel.

## Declare contracts

```lisp
(type AccountId (Brand String))
(type Account {:id AccountId :balance Int})
(error AccountNotFound {:id AccountId})

(rpc-group Accounts
  (rpc "GetAccount" :payload {:id AccountId}
    :success Account :error AccountNotFound)
  (rpc "Health" :payload Unit :success String))
```

`rpc` requires a string wire name, payload schema and success schema. `:error`
is optional and defaults to `Schema.Never`. An error may be a declared error,
a union, or another supported serializable schema. `rpc-group` exports a native
group under its Forma name converted to PascalCase; wire names remain unchanged.
Names must be unique within a group, but different groups may reuse a wire name.

Bootstrap with `bootstrapRpcPreludes()` from `@formalang/ts/rpc`, or load
`compiler.lisp` and `rpc.lisp` with the descriptor bootstrap API. The prelude's
form holes, duplicate-name check and emit hooks use the existing extension system.

## Generate Effect code

```ts
import { generateRpcProgram } from "@formalang/ts/rpc";

const result = generateRpcProgram(source, { sourceId: "accounts.forma" });
if (!result.ok) throw new Error(result.diagnostics.map(d => d.message).join("\n"));
// Write result.code to accounts.ts.
```

The host adapter combines ordinary mechanics declarations with the prelude's
emitted groups. It checks schema references and shapes using existing Forma
checks, rejects duplicate/generated-name conflicts and malformed contracts,
and omits code on failure. It is a TypeScript host adapter, not a new language
primitive. Contracts are inside groups; bare top-level `rpc` forms are rejected.

By default the output includes the domain schemas, errors, services and operations
authored alongside the groups. To share exactly the same runtime schema values
with an HTTP module:

```ts
const rpc = generateRpcProgram(domainSource + "\n" + rpcSource, {
  sourceId: "accounts-rpc.forma",
  schemasFrom: "./accounts-http.js",
});
```

With `schemasFrom`, the output imports only schemas referenced by RPC contracts
and emits the groups, not a second copy of the domain module. The source still
needs those domain declarations for checking. The caller must provide a module
exporting the corresponding generated schema names; TypeScript checks that module
boundary. This option is not Forma file-module import resolution.

## Implement and serve with native Effect

Handlers retain Effect's inferred payload, success, error and service types:

```ts
import { Effect, Layer } from "effect";
import { HttpRouter, HttpServer } from "effect/http";
import { RpcServer, RpcSerialization } from "effect/rpc";
import { Accounts, AccountNotFound } from "./accounts.js";

const handlers = Accounts.toLayer({
  GetAccount: ({ id }) => Effect.fail(new AccountNotFound({ id })),
  Health: () => Effect.succeed("ok"),
});
const routes = RpcServer.layerHttp({
  group: Accounts, path: "/rpc", protocol: "http",
}).pipe(
  Layer.provide(handlers),
  Layer.provide(RpcSerialization.layerNdjson),
  Layer.provide(HttpServer.layerServices),
);
const web = HttpRouter.toWebHandler(routes);
// await web.handler(request); await web.dispose() when finished.
```

Use native `RpcClient.make(Accounts)` with
`RpcClient.layerProtocolHttp({ url })`, an HTTP client and the matching
serialization layer. Effect handles decoding, encoding, service requirements,
scopes and typed failures. NDJSON is Effect's protocol, not JSON-RPC 2.0.
Malformed payloads use Effect 4.1.1's schema-defect envelope; declared domain
failures remain recoverable with `Effect.catchTag`.

The [HTTP/RPC booking example](https://github.com/bjacobso/forma/tree/main/examples/http-rpc)
contains a runnable server, native client, shared domain schemas, generated output
and integration tests for both transports.

## Current limits

This is a unary contract prelude, not a whole application framework. Native code
still supplies handlers, service implementations, transport/serialization layers,
authentication and process startup. No Forma handler-link syntax, streaming RPC,
middleware declarations, TypeScript builder DSL or file-module RPC linking is
implemented. Runtime validation and native Effect handler typing are tested;
portable RPC artifact validation and other code-generation targets are not claimed.
