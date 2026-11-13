import assert from "node:assert/strict";
import { Effect, Layer } from "effect";
import { TestRunner } from "effect/cluster";
import { HttpRouter, HttpServer } from "effect/http";
import { HttpApiBuilder } from "effect/http-api";
import { RpcTest } from "effect/rpc";
import { Account, AccountId, AccountLive, AccountNotFound, Bank, BankAccountsLive, Ledger, LedgerRpc, lookup } from "./expected.js";

// One Ledger implementation serves the HTTP handler and the RPC handler,
// which both call the generated lookup operation.
const ledger = Layer.succeed(Ledger, {
  find: (id) => id === "missing"
    ? Effect.fail(new AccountNotFound({ id }))
    : Effect.succeed({ id, balance: 70 }),
});
const rpcHandlers = LedgerRpc.toLayer({ GetBalance: (payload) => lookup({ params: payload }) });

export default async function check(): Promise<void> {
  const web = HttpRouter.toWebHandler(HttpApiBuilder.layer(Bank).pipe(
    Layer.provide(BankAccountsLive),
    HttpRouter.provideRequest(ledger),
    Layer.provide(HttpServer.layerServices),
  ), { disableLogger: true });
  try {
    const found = await web.handler(new Request("http://localhost/accounts/acct-1"));
    assert.equal(found.status, 200);
    assert.deepEqual(await found.json(), { id: "acct-1", balance: 70 });
    const missing = await web.handler(new Request("http://localhost/accounts/missing"));
    assert.equal(missing.status, 404);
    assert.deepEqual(await missing.json(), { _tag: "AccountNotFound", id: "missing" });
  } finally {
    await web.dispose();
  }

  const rpc = await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
    const client = yield* RpcTest.makeClient(LedgerRpc);
    const found = yield* client.GetBalance({ id: AccountId.make("acct-1") });
    const missing = yield* client.GetBalance({ id: AccountId.make("missing") }).pipe(
      Effect.catchTag("AccountNotFound", (error) => Effect.succeed(`${error._tag} ${error.id}`)),
    );
    return { found, missing };
  })).pipe(Effect.provide(rpcHandlers), Effect.provide(ledger)));
  assert.deepEqual(rpc.found, { id: "acct-1", balance: 70 });
  assert.equal(rpc.missing, "AccountNotFound missing");

  const entity = await Effect.runPromise(Effect.gen(function* () {
    const account = (yield* Account.client)("acct-1");
    const first = yield* account.Deposit({ key: "dep-1", amount: 50 });
    const retried = yield* account.Deposit({ key: "dep-1", amount: 50 });
    const balance = yield* account.Balance();
    return { first, retried, balance };
  }).pipe(Effect.provide(AccountLive.pipe(Layer.provideMerge(TestRunner.layer)))));
  // The persisted Deposit is keyed, so the retry returns the stored reply.
  assert.deepEqual(entity, { first: 50, retried: 50, balance: 50 });
}
