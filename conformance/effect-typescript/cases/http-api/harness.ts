import assert from "node:assert/strict";
import { Effect, Layer, Schema } from "effect";
import { HttpRouter, HttpServer } from "effect/unstable/http";
import { HttpApiBuilder } from "effect/unstable/httpapi";
import { Shop, ShopUsersLive, ShopSystemLive, User, UserId, UserNotFound, UserRepo } from "./expected.js";
import { Api, Group, Endpoint } from "./builders.js";

const built = Api.make("Shop").add(
  Group.make("users")
    .add(Endpoint.get("get-user", "/users/:id", {
      params: Schema.Struct({ id: UserId }), success: User, errors: [UserNotFound],
    }))
    .add(Endpoint.post("create-user", "/users", { payload: User, success: User })),
).add(Group.make("system").add(Endpoint.get("health", "/health", { success: Schema.String })));

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
type Assert<T extends true> = T;
export type BuilderGroups = Assert<Equal<keyof typeof built.value.groups, "users" | "system">>;
export type BuilderEndpoints = Assert<Equal<keyof typeof built.value.groups.users.endpoints, "get-user" | "create-user">>;

// These handlers compile only if names, request fields, brands, and success
// schemas survive the generated .add() chain. No explicit handler annotations.
const builtUsers = HttpApiBuilder.group(built.value, "users", handlers => handlers
  .handle("get-user", request => Effect.succeed({ id: request.params.id, name: "Builder" }))
  .handle("create-user", request => Effect.succeed(request.payload)));
const builtSystem = HttpApiBuilder.group(built.value, "system", handlers => handlers
  .handle("health", () => Effect.succeed("builder-ok")));

export default async function check(): Promise<void> {
  const repository = Layer.succeed(UserRepo, {
    find: (id) => id === "missing"
      ? Effect.fail(new UserNotFound({ id }))
      : Effect.succeed({ id, name: "Ada" }),
  });
  const routes = HttpApiBuilder.layer(Shop).pipe(
    Layer.provide([ShopUsersLive, ShopSystemLive]),
    HttpRouter.provideRequest(repository),
    Layer.provide(HttpServer.layerServices),
  );
  const web = HttpRouter.toWebHandler(routes, { disableLogger: true });
  const builderWeb = HttpRouter.toWebHandler(HttpApiBuilder.layer(built.value).pipe(
    Layer.provide([builtUsers, builtSystem]), Layer.provide(HttpServer.layerServices),
  ), { disableLogger: true });
  try {
    const response = await web.handler(new Request("http://localhost/users/ada"));
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { id: "ada", name: "Ada" });
    const missing = await web.handler(new Request("http://localhost/users/missing"));
    assert.equal(missing.status, 404);
    assert.deepEqual(await missing.json(), { _tag: "UserNotFound", id: "missing" });
    const created = await web.handler(new Request("http://localhost/users", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: "new", name: "New User" }),
    }));
    assert.equal(created.status, 200);
    assert.deepEqual(await created.json(), { id: "new", name: "New User" });
    const invalid = await web.handler(new Request("http://localhost/users", {
      method: "POST", headers: { "content-type": "application/json" }, body: '{"id":42}',
    }));
    assert.equal(invalid.status, 400);
    const health = await web.handler(new Request("http://localhost/health"));
    assert.equal(await health.json(), "ok");
    const builderResponse = await builderWeb.handler(new Request("http://localhost/users/ada"));
    assert.deepEqual(await builderResponse.json(), { id: "ada", name: "Builder" });
    assert.equal(built.ir.kind, "HttpApi");
    assert.equal(built.ir.groups[0]?.endpoints[0]?.name, "get-user");
    assert.equal(built.ir.groups[0]?.endpoints[0]?.success, User);
  } finally {
    await Promise.all([web.dispose(), builderWeb.dispose()]);
  }
}
