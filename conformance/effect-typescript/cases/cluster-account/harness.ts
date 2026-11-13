import assert from "node:assert/strict";
import { Effect, Layer, Ref, Schema } from "effect";
import { ClusterSchema, Entity, TestRunner } from "effect/cluster";
import { Rpc } from "effect/rpc";
import { Account, AccountLive, Deposit, accountBalance, accountDeposit, accountInitial } from "./expected.js";

// Control: the same Deposit without the primary key the cluster prelude
// requires. This is the code the cluster/unkeyed-command check rejects.
const Unkeyed = Entity.make("UnkeyedAccount", [
  Rpc.make("Deposit", { payload: Deposit.fields, success: Schema.Int }).annotate(ClusterSchema.Persisted, true),
  Rpc.make("Balance", { success: Schema.Int }),
]);
const UnkeyedLive = Unkeyed.toLayer(Effect.map(Ref.make(accountInitial), (stateRef) => Unkeyed.of({
  Deposit: (request) => accountDeposit(stateRef, request.payload),
  Balance: () => accountBalance(stateRef),
})));

export default async function check(): Promise<void> {
  const program = Effect.gen(function* () {
    const account = (yield* Account.client)("acct-1");
    const unkeyed = (yield* Unkeyed.client)("acct-1");

    // A client retry resends the same logical request.
    const first = yield* account.Deposit({ key: "dep-1", amount: 50 });
    const retried = yield* account.Deposit({ key: "dep-1", amount: 50 });
    const afterRetry = yield* account.Balance();

    // The guard rejects an overdraft with the declared error and keeps the state.
    const overdraft = yield* account.Withdraw({ key: "wd-1", amount: 80 }).pipe(
      Effect.catchTag("InsufficientFunds", (error) => Effect.succeed(`${error._tag} ${error.balance}/${error.requested}`)),
    );
    const withdrawn = yield* account.Withdraw({ key: "wd-2", amount: 20 });

    const unkeyedFirst = yield* unkeyed.Deposit({ key: "dep-1", amount: 50 });
    const unkeyedRetried = yield* unkeyed.Deposit({ key: "dep-1", amount: 50 });
    return { first, retried, afterRetry, overdraft, withdrawn, unkeyedFirst, unkeyedRetried };
  });
  const result = await Effect.runPromise(program.pipe(
    Effect.provide(Layer.mergeAll(AccountLive, UnkeyedLive).pipe(Layer.provideMerge(TestRunner.layer))),
  ));

  // Keyed: the retry returns the stored reply and the handler runs once.
  assert.equal(result.first, 50);
  assert.equal(result.retried, 50);
  assert.equal(result.afterRetry, 50);
  assert.equal(result.overdraft, "InsufficientFunds 50/80");
  assert.equal(result.withdrawn, 30);
  // Unkeyed control: the retry runs the handler again and deposits twice.
  assert.equal(result.unkeyedFirst, 50);
  assert.equal(result.unkeyedRetried, 100);
}
