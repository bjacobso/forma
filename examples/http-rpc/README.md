# Workshop booking: Forma → Effect HTTP and RPC

An isolated exploration using the root's pinned **Effect 4.1.1** and
**@effect/platform-node 4.1.1**. No compiler/runtime changes, new dependencies,
deployment, or Amp workspace settings are needed.

## Domain and ownership

One workshop, `ws-effect`, starts with twelve seats. Reserve one to six seats
per request. Successful reservations reduce availability; insufficient capacity
and unknown workshops are distinct typed failures. Invalid IDs, fractional seats,
missing seats, zero, and more than six seats are rejected before handlers run.

Read the files in this order:

1. `domain.forma`: shared schemas/refinements, errors, Booking service, and the
   checked `lookup` / `reserve` operations calling that service.
2. `http.forma`: GET `/workshops/:id`, POST `/reservations`, checked handler links.
3. `rpc.forma`: the same queries/commands as `GetWorkshop` and `ReserveSeats`.
4. `rpc-prelude.forma`: **example-local** typed declaration form with a Forma
   `:emit` hook producing actual `Rpc.make` calls.
5. `generate.mjs`: existing HTTP compiler plus bounded RPC form elaboration and
   emission. It assembles these files explicitly, not through Forma module imports.
6. `generated/http.ts` and `generated/rpc.ts`: reproducible output, saved for
   inspection. HTTP output owns the shared schemas; RPC imports those exact values.
7. `runtime.ts`: **hand-authored**, explicit native Effect Booking implementation,
   RPC registration, HTTP/RPC transport layers and Swagger. The native RPC handlers
   reuse the generated operations; both transports reach the same repository.
8. `client.ts`: **hand-authored** native Effect RPC client using generated contracts.

For example, the RPC form emits this (not a dispatch interpreter):

```ts
Rpc.make("ReserveSeats", {
  payload: Reserve,
  success: Workshop,
  error: Schema.Union([WorkshopNotFound, NotEnoughSeats]),
})
```

The business decision is explicit in `runtime.ts`: look up availability, fail with
`WorkshopNotFound` or `NotEnoughSeats`, otherwise subtract the requested seats.
Generated code does not invent domain behavior. Runtime imports need Effect only,
not the Forma compiler.

## Reproduce

Use Node 24 and pnpm 10.20 from the repository root:

```sh
pnpm install --frozen-lockfile
bash examples/http-rpc/check.sh
node examples/http-rpc/server.ts
```

The check builds the compiler, checks saved generation against sources, strictly
typechecks generated and native code, and runs contract-negative and transport
integration tests. To regenerate after editing a `.forma` file:

```sh
node examples/http-rpc/generate.mjs
```

The server defaults to port 3000 (`PORT` overrides it). `/` is Swagger with
executable HTTP requests. For an orb portal, start a supervised service instead:

```sh
amp orb service start workshop-demo --command 'node examples/http-rpc/server.ts' --port 3000 --portal
```

Use the returned portal URL as `DEMO_URL` for remote requests. No persistent
service configuration is added by this example.

## Compare both transports

In another terminal, against a freshly started local server:

```sh
export DEMO_URL=http://localhost:3000
curl -sS "$DEMO_URL/workshops/ws-effect"
# {"id":"ws-effect","remaining":12}
curl -sS "$DEMO_URL/reservations" -H 'content-type: application/json' \
  -d '{"id":"ws-effect","seats":5}'
# {"id":"ws-effect","remaining":7}
node examples/http-rpc/client.ts
# RPC GetWorkshop { id: 'ws-effect', remaining: 7 }
# RPC ReserveSeats { id: 'ws-effect', remaining: 5 }
# RPC missing { _tag: 'WorkshopNotFound', id: 'ws-unknown' }
curl -sS -w '\nHTTP %{http_code}\n' "$DEMO_URL/reservations" \
  -H 'content-type: application/json' -d '{"id":"ws-effect","seats":6}'
# {"_tag":"NotEnoughSeats","id":"ws-effect","requested":6,"remaining":5}
# HTTP 409
```

For an untrusted RPC wire request (Effect's NDJSON protocol, **not JSON-RPC 2.0**):

```sh
printf '%s\n' '{"_tag":"Request","id":"1","tag":"ReserveSeats","payload":{"id":"ws-effect","seats":0},"headers":[]}' \
  | curl -sS "$DEMO_URL/rpc" -H 'content-type: application/ndjson' --data-binary @-
# Exit / Failure / Die: Expected a value greater than or equal to 1 at ["seats"]
```

NDJSON needs the final newline. HTTP invalid payloads return 400; unknown
workshops return 404; insufficient seats return 409. RPC domain errors travel
as typed failures recoverable with `Effect.catchTag`. RPC payload validation
uses Effect 4.1.1's `Die` defect envelope, not a domain error or an HTTP 400.
The tests assert this distinction and verify rejected requests leave state intact.

## Verification scope and current limits

- `demo.test.ts` uses real Effect HTTP/RPC serialization, decoders and handlers,
  including a native RPC client. It injects fetch into the Web handler: no socket
  is needed for deterministic tests. `server.ts` and `client.ts` exercise real
  sockets; the walkthrough above was also run against the supervised server.
- HTTP lowering is the existing shipped spike, not universal HTTP support.
  Its documented middleware, streaming and module-import limits still apply.
- RPC lowering exists **only in this directory**. The generator has fixed
  domain imports and one unary group. It checks required form holes and duplicate
  RPC names; strict TypeScript checks native handler compatibility and unresolved
  generated schema references. It does not implement a general RPC linker,
  arbitrary service-method inference, streaming, middleware or package generation.
- Refinements run at transport decoding, not as static proofs of arbitrary Forma
  expressions. Native code calling service methods directly must validate its own
  untrusted input.
- Availability is in-memory and resets on server restart. Check/update has no
  suspension, so it is atomic in one JavaScript process, not across replicas.
  No persistence, authentication, cancellation policy, idempotency or production
  reservation lifecycle is claimed. Swagger covers HTTP, not RPC.
- These checks are intentionally local to the example, not added to root CI.
  Generated code remains reviewable; `--check` fails rather than rewriting drift.
