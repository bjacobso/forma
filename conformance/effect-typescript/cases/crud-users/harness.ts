import assert from "node:assert/strict";
import { Effect, Layer, Option } from "effect";
import {
  adminNames,
  createUser,
  deleteUser,
  DuplicateEmail,
  findOrDefault,
  getUser,
  Ids,
  InvalidUser,
  renameUser,
  UserId,
  UserNotFound,
  UserRepo,
  UserRepoMemory,
} from "./expected.js";

const IdsTest = Layer.sync(Ids, () => {
  let next = 0;
  return Ids.of({ next: Effect.sync(() => UserId.make(`user-${++next}`)) });
});

const AppTest = Layer.mergeAll(UserRepoMemory, IdsTest);

export default async function check(): Promise<void> {
  const program = Effect.gen(function* () {
    const ada = yield* createUser({ name: "Ada", email: "ada@example.com", role: "admin" });
    assert.deepEqual(ada, { id: "user-1", name: "Ada", email: "ada@example.com", role: "admin" });
    yield* createUser({ name: "Grace", email: "grace@example.com", role: "admin" });
    yield* createUser({ name: "Linus", email: "linus@example.com", role: "member" });

    const duplicate = yield* Effect.flip(createUser({ name: "Ada 2", email: "ada@example.com", role: "member" }));
    assert.ok(duplicate instanceof DuplicateEmail);
    assert.equal(duplicate.email, "ada@example.com");

    const invalid = yield* Effect.flip(createUser({ name: "  ", email: "blank@example.com", role: "member" }));
    assert.ok(invalid instanceof InvalidUser);
    assert.equal(invalid.reason, "name is required");
    const badEmail = yield* Effect.flip(createUser({ name: "Bob", email: "bob", role: "member" }));
    assert.equal(badEmail._tag, "InvalidUser");
    assert.equal(badEmail.reason, "email is invalid");

    assert.deepEqual(yield* getUser(UserId.make("user-1")), ada);
    const renamed = yield* renameUser(UserId.make("user-1"), "Ada Lovelace");
    assert.equal(renamed.name, "Ada Lovelace");
    assert.deepEqual(yield* adminNames, ["Ada Lovelace <ada@example.com>", "Grace <grace@example.com>"]);

    const repo = yield* UserRepo;
    yield* repo.save({ ...renamed, nickname: "Countess" });
    assert.deepEqual(yield* adminNames, ["Countess <ada@example.com>", "Grace <grace@example.com>"]);

    yield* deleteUser(UserId.make("user-2"));
    const missing = yield* Effect.flip(getUser(UserId.make("user-2")));
    assert.ok(missing instanceof UserNotFound);
    assert.equal(missing.id, "user-2");
    const missingDelete = yield* Effect.flip(deleteUser(UserId.make("user-2")));
    assert.equal(missingDelete._tag, "UserNotFound");

    assert.equal(yield* findOrDefault(UserId.make("user-3"), "nobody"), "Linus");
    assert.equal(yield* findOrDefault(UserId.make("user-9"), "nobody"), "nobody");
    assert.ok(Option.isNone(yield* repo.find(UserId.make("user-9"))));
  });

  await Effect.runPromise(program.pipe(Effect.provide(AppTest)));
}
