import { Context, Effect, Schema } from "effect";

export const UserId = Schema.String.pipe(Schema.brand("UserId"));
export type UserId = typeof UserId.Type;

export const User = Schema.Struct({
  id: UserId,
  name: Schema.String,
});
export type User = typeof User.Type;

export class UserNotFound extends Schema.TaggedError<UserNotFound>()("UserNotFound", {
  id: UserId,
}) {}

export class UserRepo extends Context.Service<
  UserRepo,
  {
    readonly find: (arg0: UserId) => Effect.Effect<User, UserNotFound>;
  }
>()("UserRepo") {}

export const lookup = (
  request: { readonly params: { readonly id: UserId } },
): Effect.Effect<User, UserNotFound, UserRepo> =>
  Effect.gen(function* () {
    const userRepo = yield* UserRepo;
    const user = yield* userRepo.find(request.params.id);
    return user;
  });

export const createUser = (request: { readonly payload: User }): Effect.Effect<User> =>
  Effect.gen(function* () {
    return request.payload;
  });

export const health = (_request: {}): Effect.Effect<string> =>
  Effect.gen(function* () {
    return "ok";
  });
import { HttpApi, HttpApiBuilder, HttpApiEndpoint, HttpApiGroup } from "effect/unstable/httpapi";

export const Shop = HttpApi.make("Shop").add(HttpApiGroup.make("users").add(HttpApiEndpoint.get("get-user", "/users/:id", { "success": User, "error": [UserNotFound.annotate({"httpApiStatus":404})], "params": Schema.Struct({ id: UserId }) }), HttpApiEndpoint.post("create-user", "/users", { "success": User, "error": [], "payload": User })), HttpApiGroup.make("system").add(HttpApiEndpoint.get("health", "/health", { "success": Schema.String, "error": [] })));

export const ShopUsersLive = HttpApiBuilder.group(Shop, "users", (handlers) => (handlers.handle("get-user", lookup).handle("create-user", createUser)));

export const ShopSystemLive = HttpApiBuilder.group(Shop, "system", (handlers) => (handlers.handle("health", health)));
