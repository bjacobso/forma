import { createServer } from "node:http";
import { Effect, Layer } from "effect";
import { HttpRouter } from "effect/http";
import { NodeHttpServer, NodeRuntime } from "@effect/platform-node";
import { makeRoutes } from "./runtime.ts";

const port = Number(process.env["PORT"] ?? 3000);
HttpRouter.serve(makeRoutes()).pipe(
  Layer.provide(NodeHttpServer.layer(createServer, { port, host: "0.0.0.0" })),
  Layer.launch,
  Effect.tap(() => Effect.log(`Workshop API on port ${port}`)),
  NodeRuntime.runMain,
);
