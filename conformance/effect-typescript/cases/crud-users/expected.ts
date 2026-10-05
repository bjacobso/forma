import { Context, Effect, Layer, Option, Record, Ref, Schema } from "effect";

export const UserId = Schema.String.pipe(Schema.brand("UserId"));
export type UserId = typeof UserId.Type;

export const Role = Schema.Literals(["admin", "member"]);
export type Role = typeof Role.Type;

export const User = Schema.Struct({
  id: UserId,
  name: Schema.String,
  email: Schema.String,
  role: Role,
  nickname: Schema.optionalKey(Schema.String),
});
export type User = typeof User.Type;

export const NewUser = Schema.Struct({
  name: Schema.String,
  email: Schema.String,
  role: Role,
});
export type NewUser = typeof NewUser.Type;

export class UserNotFound extends Schema.TaggedError<UserNotFound>()("UserNotFound", {
  id: UserId,
}) {}

export class DuplicateEmail extends Schema.TaggedError<DuplicateEmail>()("DuplicateEmail", {
  email: Schema.String,
}) {}

export class InvalidUser extends Schema.TaggedError<InvalidUser>()("InvalidUser", {
  reason: Schema.String,
}) {}

export class UserRepo extends Context.Service<
  UserRepo,
  {
    readonly find: (id: UserId) => Effect.Effect<Option.Option<User>>;
    readonly findByEmail: (email: string) => Effect.Effect<Option.Option<User>>;
    readonly save: (user: User) => Effect.Effect<void>;
    readonly remove: (id: UserId) => Effect.Effect<boolean>;
    readonly all: () => Effect.Effect<ReadonlyArray<User>>;
  }
>()("UserRepo") {}

export class Ids extends Context.Service<
  Ids,
  {
    readonly next: () => Effect.Effect<UserId>;
  }
>()("Ids") {}

export const displayName = (user: User): string =>
  `${Option.getOrElse(Option.fromUndefinedOr(user.nickname), (): string => user.name)} <${user.email}>`;

export const validate = (input: NewUser): Effect.Effect<NewUser, InvalidUser> =>
  Effect.gen(function* () {
    if (input.name.trim() === "") {
      return yield* Effect.fail(new InvalidUser({ reason: "name is required" }));
    } else if (!input.email.includes("@")) {
      return yield* Effect.fail(new InvalidUser({ reason: "email is invalid" }));
    } else {
      return input;
    }
  });

export const createUser = (
  input: NewUser,
): Effect.Effect<User, InvalidUser | DuplicateEmail, Ids | UserRepo> =>
  Effect.gen(function* () {
    const ids = yield* Ids;
    const userRepo = yield* UserRepo;
    const valid = yield* validate(input);
    const existing = yield* userRepo.findByEmail(valid.email);
    if (Option.isSome(existing)) {
      return yield* Effect.fail(new DuplicateEmail({ email: valid.email }));
    } else {
      const id = yield* ids.next();
      const user = { id, name: valid.name, email: valid.email, role: valid.role };
      yield* userRepo.save(user);
      return user;
    }
  });

export const getUser = (id: UserId): Effect.Effect<User, UserNotFound, UserRepo> =>
  Effect.gen(function* () {
    const userRepo = yield* UserRepo;
    const found = yield* userRepo.find(id);
    if (Option.isSome(found)) {
      const user = found.value;
      return user;
    } else {
      return yield* Effect.fail(new UserNotFound({ id }));
    }
  });

export const renameUser = (
  id: UserId,
  name: string,
): Effect.Effect<User, UserNotFound | InvalidUser, UserRepo> =>
  Effect.gen(function* () {
    const userRepo = yield* UserRepo;
    const user = yield* getUser(id);
    if (name.trim() === "") {
      return yield* Effect.fail(new InvalidUser({ reason: "name is required" }));
    } else {
      const renamed = { ...user, name };
      yield* userRepo.save(renamed);
      return renamed;
    }
  });

export const deleteUser = (id: UserId): Effect.Effect<void, UserNotFound, UserRepo> =>
  Effect.gen(function* () {
    const userRepo = yield* UserRepo;
    const removed = yield* userRepo.remove(id);
    if (!removed) {
      yield* Effect.fail(new UserNotFound({ id }));
    }
    return;
  });

export const adminNames = (): Effect.Effect<ReadonlyArray<string>, never, UserRepo> =>
  Effect.gen(function* () {
    const userRepo = yield* UserRepo;
    const users = yield* userRepo.all();
    return users.filter((user) => user.role === "admin").map(displayName);
  });

export const findOrDefault = (
  id: UserId,
  fallback: string,
): Effect.Effect<string, never, UserRepo> =>
  Effect.gen(function* () {
    return yield* Effect.catchTag(
      Effect.gen(function* () {
        const user = yield* getUser(id);
        return user.name;
      }),
      "UserNotFound",
      () => Effect.succeed(fallback),
    );
  });

export const UserRepoMemory: Layer.Layer<UserRepo> = Layer.effect(
  UserRepo,
  Effect.gen(function* () {
    const store = yield* Ref.make<{ readonly [key: string]: User }>({});
    return UserRepo.of({
      find: (id) =>
        Effect.gen(function* () {
          const users = yield* Ref.get(store);
          return Record.get(users, id);
        }),
      findByEmail: (email) =>
        Effect.gen(function* () {
          const users = yield* Ref.get(store);
          return Option.fromUndefinedOr(Record.values(users).find((user) => user.email === email));
        }),
      save: (user) => Ref.update(store, (users) => ({ ...users, [user.id]: user })),
      remove: (id) =>
        Effect.gen(function* () {
          const users = yield* Ref.get(store);
          yield* Ref.set(store, Record.remove(users, id));
          return Record.has(users, id);
        }),
      all: () =>
        Effect.gen(function* () {
          const users = yield* Ref.get(store);
          return Record.values(users);
        }),
    });
  }),
);
