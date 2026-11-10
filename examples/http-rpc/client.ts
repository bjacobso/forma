// Hand-authored native Effect RPC client; uses generated contracts.
import { Effect, Layer } from "effect";
import { FetchHttpClient } from "effect/http";
import { RpcClient, RpcSerialization } from "effect/rpc";
import { WorkshopRpc } from "./generated/rpc.ts";

const base = process.env["DEMO_URL"] ?? "http://localhost:3000";
const protocol = RpcClient.layerProtocolHttp({ url: `${base}/rpc` }).pipe(
  Layer.provide(RpcSerialization.layerNdjson),
  Layer.provide(FetchHttpClient.layer),
);
await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
  const client = yield* RpcClient.make(WorkshopRpc);
  console.log("RPC GetWorkshop", yield* client.GetWorkshop({ id: "ws-effect" }));
  console.log("RPC ReserveSeats", yield* client.ReserveSeats({ id: "ws-effect", seats: 2 }));
  console.log("RPC missing", yield* client.GetWorkshop({ id: "ws-unknown" }).pipe(
    Effect.catchTag("WorkshopNotFound", error => Effect.succeed({ ...error })),
  ));
})).pipe(Effect.provide(protocol)));
