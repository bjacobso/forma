import assert from "node:assert/strict";
import { test } from "node:test";
import { Effect, Layer } from "effect";
import { FetchHttpClient } from "effect/http";
import { RpcClient, RpcSerialization } from "effect/rpc";
import { WorkshopRpc } from "./generated/rpc.ts";
import { makeWebHandler } from "./runtime.ts";

test("HTTP and native RPC share state, validation and typed errors", async () => {
  const web = makeWebHandler();
  const request = (path: string, body?: unknown) => web.handler(new Request(`http://demo${path}`, body === undefined ? {} : {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) + "\n",
  }));
  const protocol = RpcClient.layerProtocolHttp({ url: "http://demo/rpc" }).pipe(
    Layer.provide(RpcSerialization.layerNdjson),
    Layer.provide(FetchHttpClient.layer),
  );
  try {
    const initial = await request("/workshops/ws-effect");
    assert.equal(initial.status, 200);
    assert.deepEqual(await initial.json(), { id: "ws-effect", remaining: 12 });
    const booked = await request("/reservations", { id: "ws-effect", seats: 5 });
    assert.equal(booked.status, 200);
    assert.deepEqual(await booked.json(), { id: "ws-effect", remaining: 7 });

    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
      const client = yield* RpcClient.make(WorkshopRpc);
      assert.deepEqual(yield* client.GetWorkshop({ id: "ws-effect" }), { id: "ws-effect", remaining: 7 });
      assert.deepEqual(yield* client.ReserveSeats({ id: "ws-effect", seats: 6 }), { id: "ws-effect", remaining: 1 });
      const conflict = yield* client.ReserveSeats({ id: "ws-effect", seats: 2 }).pipe(
        Effect.catchTag("NotEnoughSeats", error => Effect.succeed({ ...error })),
      );
      assert.deepEqual(conflict, { _tag: "NotEnoughSeats", id: "ws-effect", requested: 2, remaining: 1 });
      const missing = yield* client.GetWorkshop({ id: "ws-unknown" }).pipe(
        Effect.catchTag("WorkshopNotFound", error => Effect.succeed({ ...error })),
      );
      assert.deepEqual(missing, { _tag: "WorkshopNotFound", id: "ws-unknown" });
    })).pipe(
      Effect.provide(protocol),
      Effect.provideService(FetchHttpClient.Fetch, (input, init) => web.handler(new Request(input, init))),
    ));

    const after = await request("/workshops/ws-effect");
    assert.deepEqual(await after.json(), { id: "ws-effect", remaining: 1 });
    const conflict = await request("/reservations", { id: "ws-effect", seats: 2 });
    assert.equal(conflict.status, 409);
    assert.deepEqual(await conflict.json(), { _tag: "NotEnoughSeats", id: "ws-effect", requested: 2, remaining: 1 });
    const missing = await request("/workshops/ws-unknown");
    assert.equal(missing.status, 404);
    assert.deepEqual(await missing.json(), { _tag: "WorkshopNotFound", id: "ws-unknown" });
    for (const payload of [{ id: "ws-effect", seats: 0 }, { id: "ws-effect", seats: 7 }, { id: "ws-effect", seats: 1.5 }, { id: "bad", seats: 1 }, { id: "ws-effect" }]) {
      assert.equal((await request("/reservations", payload)).status, 400);
      // Bypass the typed client: exercise server-side RPC decoding of untrusted wire input.
      const invalid = await request("/rpc", { _tag: "Request", id: "1", tag: "ReserveSeats", payload, headers: [] });
      const wire = await invalid.text();
      const message = JSON.parse(wire);
      assert.equal(message._tag, "Exit");
      assert.equal(message.exit._tag, "Failure");
      assert.equal(message.exit.cause[0]._tag, "Die");
      assert.match(message.exit.cause[0].defect, /seats|id/);
    }
    assert.equal((await request("/workshops/not-an-id")).status, 400);
    assert.deepEqual(await (await request("/workshops/ws-effect")).json(), { id: "ws-effect", remaining: 1 });
    const last = await request("/reservations", { id: "ws-effect", seats: 1 });
    assert.equal(last.status, 200);
    assert.deepEqual(await last.json(), { id: "ws-effect", remaining: 0 });
    assert.equal((await request("/reservations", { id: "ws-effect", seats: 1 })).status, 409);
  } finally { await web.dispose(); }
});
