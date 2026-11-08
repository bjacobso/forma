// Hand-authored native Effect implementation. No Forma interpreter at runtime.
import { Effect, Layer } from "effect";
import { HttpRouter, HttpServer } from "effect/http";
import { HttpApiBuilder, HttpApiSwagger } from "effect/http-api";
import { RpcServer, RpcSerialization } from "effect/rpc";
import { Booking, Workshop, WorkshopNotFound, NotEnoughSeats, Workshops, WorkshopsBookingLive, lookup, reserve } from "./generated/http.ts";
import { WorkshopRpc } from "./generated/rpc.ts";

export function makeRoutes() {
  const remaining = new Map([["ws-effect", 12]]);
  const repository = Layer.succeed(Booking, {
    find: id => Effect.suspend(() => {
      const seats = remaining.get(id);
      return seats === undefined
        ? Effect.fail(new WorkshopNotFound({ id }))
        : Effect.succeed({ id, remaining: seats });
    }),
    reserve: request => Effect.suspend<Workshop, WorkshopNotFound | NotEnoughSeats, never>(() => {
      const seats = remaining.get(request.id);
      if (seats === undefined) return Effect.fail(new WorkshopNotFound({ id: request.id }));
      if (request.seats > seats) return Effect.fail(new NotEnoughSeats({
        id: request.id, requested: request.seats, remaining: seats,
      }));
      // No suspension between checking and updating: atomic within this process.
      remaining.set(request.id, seats - request.seats);
      return Effect.succeed({ id: request.id, remaining: seats - request.seats });
    }),
  });
  const rpcHandlers = WorkshopRpc.toLayer({
    GetWorkshop: payload => lookup({ params: payload }),
    ReserveSeats: payload => reserve({ payload }),
  }).pipe(Layer.provide(repository));
  const http = HttpApiBuilder.layer(Workshops).pipe(
    Layer.provide(WorkshopsBookingLive),
    HttpRouter.provideRequest(repository),
  );
  const rpc = RpcServer.layerHttp({ group: WorkshopRpc, path: "/rpc", protocol: "http" }).pipe(
    Layer.provide(rpcHandlers),
    Layer.provide(RpcSerialization.layerNdjson),
  );
  return Layer.mergeAll(http, rpc, HttpApiSwagger.layer(Workshops, { path: "/" }));
}

export const makeWebHandler = () => HttpRouter.toWebHandler(
  makeRoutes().pipe(Layer.provide(HttpServer.layerServices)),
  { disableLogger: true },
);
