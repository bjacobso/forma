import { Context, Effect, Ref, Schema } from "effect";
import { ClusterSchema, Entity } from "effect/cluster";
import { HttpApi, HttpApiBuilder, HttpApiEndpoint, HttpApiGroup } from "effect/http-api";
import { Rpc, RpcGroup } from "effect/rpc";

const __formaInt = (value: number): number => {
  if (!Number.isSafeInteger(value)) throw new RangeError("Int outside the safe integer range");
  return value === 0 ? 0 : value;
};

export const AccountId = Schema.String.pipe(Schema.brand("AccountId"));
export type AccountId = typeof AccountId.Type;

export const Amount = Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)).check(Schema.isLessThanOrEqualTo(1000));
export type Amount = typeof Amount.Type;

export const Balance = Schema.Struct({
  id: AccountId,
  balance: Schema.Int,
});
export type Balance = typeof Balance.Type;

export const Deposit = Schema.Struct({
  key: Schema.String,
  amount: Amount,
});
export type Deposit = typeof Deposit.Type;

export const AccountState = Schema.Struct({
  balance: Schema.Int,
});
export type AccountState = typeof AccountState.Type;

export class AccountNotFound extends Schema.TaggedError<AccountNotFound>()("AccountNotFound", {
  id: AccountId,
}) {}

export class Ledger extends Context.Service<
  Ledger,
  {
    readonly find: (arg0: AccountId) => Effect.Effect<Balance, AccountNotFound>;
  }
>()("Ledger") {}

export const lookup = (
  request: { readonly params: { readonly id: AccountId } },
): Effect.Effect<Balance, AccountNotFound, Ledger> =>
  Effect.gen(function* () {
    const ledger = yield* Ledger;
    const balance = yield* ledger.find(request.params.id);
    return balance;
  });

export const accountDeposit = (
  stateRef: Ref.Ref<AccountState>,
  payload: Deposit,
): Effect.Effect<number> =>
  Effect.gen(function* () {
    const state = yield* Ref.get(stateRef);
    const amount = payload.amount;
    const state2 = { balance: __formaInt(state.balance + amount) };
    yield* Ref.set(stateRef, state2);
    return state2.balance;
  });

export const accountBalance = (stateRef: Ref.Ref<AccountState>): Effect.Effect<number> =>
  Effect.gen(function* () {
    const state = yield* Ref.get(stateRef);
    return state.balance;
  });

export const accountInitial: AccountState = { balance: 0 };

export const LedgerRpc = RpcGroup.make(Rpc.make("GetBalance", { "payload": Schema.Struct({ id: AccountId }), "success": Balance, "error": AccountNotFound }));

export const Bank = HttpApi.make("Bank").add(HttpApiGroup.make("accounts").add(HttpApiEndpoint.get("get-balance", "/accounts/:id", { "success": Balance, "error": [AccountNotFound.annotate({"httpApiStatus":404})], "params": Schema.Struct({ id: AccountId }) })));

export const BankAccountsLive = HttpApiBuilder.group(Bank, "accounts", (handlers) => (handlers.handle("get-balance", lookup)));

export const Account = Entity.make("Account", [Rpc.make("Deposit", { "success": Schema.Int, "payload": Deposit.fields, "primaryKey": (payload) => (payload.key) }).annotate(ClusterSchema.Persisted, true), Rpc.make("Balance", { "success": Schema.Int })]);

export const AccountLive = Account.toLayer(Effect.map(Ref.make(accountInitial), (stateRef) => (Account.of({ "Deposit": (request) => (accountDeposit(stateRef, request.payload)), "Balance": () => (Rpc.fork(accountBalance(stateRef))) }))));
