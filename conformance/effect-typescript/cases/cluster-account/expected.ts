import { Effect, Ref, Schema } from "effect";
import { ClusterSchema, Entity } from "effect/cluster";
import { Rpc } from "effect/rpc";

const __formaInt = (value: number): number => {
  if (!Number.isSafeInteger(value)) throw new RangeError("Int outside the safe integer range");
  return value === 0 ? 0 : value;
};

export const Amount = Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)).check(Schema.isLessThanOrEqualTo(1000));
export type Amount = typeof Amount.Type;

export const Deposit = Schema.Struct({
  key: Schema.String,
  amount: Amount,
});
export type Deposit = typeof Deposit.Type;

export const AccountState = Schema.Struct({
  balance: Schema.Int,
});
export type AccountState = typeof AccountState.Type;

export class InsufficientFunds extends Schema.TaggedError<InsufficientFunds>()("InsufficientFunds", {
  balance: Schema.Int,
  requested: Amount,
}) {}

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

export const accountWithdraw = (
  stateRef: Ref.Ref<AccountState>,
  payload: { readonly key: string; readonly amount: Amount },
): Effect.Effect<number, InsufficientFunds> =>
  Effect.gen(function* () {
    const state = yield* Ref.get(stateRef);
    const amount = payload.amount;
    if (amount <= state.balance) {
      const state2 = { balance: __formaInt(state.balance - amount) };
      yield* Ref.set(stateRef, state2);
      return state2.balance;
    } else {
      return yield* Effect.fail(new InsufficientFunds({ balance: state.balance, requested: amount }));
    }
  });

export const accountBalance = (stateRef: Ref.Ref<AccountState>): Effect.Effect<number> =>
  Effect.gen(function* () {
    const state = yield* Ref.get(stateRef);
    return state.balance;
  });

export const accountInitial: AccountState = { balance: 0 };

export const Account = Entity.make("Account", [Rpc.make("Deposit", { "success": Schema.Int, "payload": Deposit.fields, "primaryKey": (payload) => (payload.key) }).annotate(ClusterSchema.Persisted, true), Rpc.make("Withdraw", { "success": Schema.Int, "payload": { key: Schema.String, amount: Amount }, "error": InsufficientFunds, "primaryKey": (payload) => (payload.key) }).annotate(ClusterSchema.Persisted, true), Rpc.make("Balance", { "success": Schema.Int })]);

export const AccountLive = Account.toLayer(Effect.map(Ref.make(accountInitial), (stateRef) => (Account.of({ "Deposit": (request) => (accountDeposit(stateRef, request.payload)), "Withdraw": (request) => (accountWithdraw(stateRef, request.payload)), "Balance": () => (Rpc.fork(accountBalance(stateRef))) }))), { "maxIdleTime": "5 minutes" });
