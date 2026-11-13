# Prelude-defined Cluster entities

`preludes/cluster.lisp` declares Effect Cluster entities for **Effect 4.1.1**
(`effect/cluster`, which Effect marks unstable). An entity has a state record,
an initial value, and messages. Each message's transition is a pure Forma
expression. The cluster linker checks those transitions as ordinary Effect
functions and emits native `Entity.make`, `Rpc.make`, and `Entity.toLayer`
code. It adds no Cluster cases to the mechanics checker and no runtime helper.

This is a prototype. State lives in memory only; see [Current limits](#current-limits).

## Declare an entity

```lisp
(type Amount (Int :min 1 :max 1000))
(type Deposit {:key String :amount Amount})
(error InsufficientFunds {:balance Int :requested Amount})

(entity Account
  :state {:balance Int}
  :initial {:balance 0}
  :storage :memory
  :accept-state-loss true
  :max-idle "5 minutes"

  (command Deposit :payload Deposit :success Int
    :delivery :persisted :dedupe-by :key
    :update {:balance (+ state.balance amount)}
    :reply state.balance)

  (command Withdraw :payload {:key String :amount Amount}
    :success Int :error InsufficientFunds
    :delivery :persisted :dedupe-by :key
    :guard (<= amount state.balance)
    :reject (InsufficientFunds {:balance state.balance :requested amount})
    :update {:balance (- state.balance amount)}
    :reply state.balance)

  (query Balance :success Int :reply state.balance))
```

A **command** may change state. Its `:guard`, `:reject`, `:update`, and
`:reply` see `state` and the payload's fields by name; `:reply` sees the state
after `:update`. When the guard is false, the command fails with `:reject` and
leaves the state unchanged. `:delivery` is required: `:persisted` stores the
request and reply in Cluster's `MessageStorage`, and `:volatile` sends it only
over the network.

A **query** is read-only. It runs concurrently with commands (`Rpc.fork`), so
it has no `:update`.

`:payload` is an inline record or the name of a record type. `:error` names a
declared error or a `(Union ...)` of them. `:max-idle` sets the entity's
passivation timeout.

## What the checker rejects

Transitions go through the same checker as other Effect programs, so an
`:update` with an unknown field, a `:reply` of the wrong type, or a `:reject`
outside the declared errors is reported at the authored expression. The prelude
adds rules that TypeScript cannot express, because it does not know which
handlers change state:

| Code | Rule |
| --- | --- |
| `cluster/unkeyed-command` | A persisted command with `:update` needs `:dedupe-by`. Without a primary key, Cluster runs a retried request again and applies the update twice. |
| `cluster/dedupe-field` | `:dedupe-by` must name a `String` or `Int` payload field. |
| `cluster/volatile-state` | Persisted commands on `:storage :memory` need `:accept-state-loss true`. A stored reply outlives in-memory state: after passivation or a restart, a retried command returns its old reply while the state restarts from `:initial`. |
| `cluster/query-updates` | A query cannot update state. |
| `cluster/guard-reject` | `:guard` and `:reject` come together. |
| `cluster/dedupe-volatile` | Only persisted messages are deduplicated. |

The [conformance cases](https://github.com/bjacobso/forma/tree/main/conformance/effect-typescript/cases)
whose names start with `cluster-` pin each diagnostic and its location.

## Generate Effect code

```ts
import { generateClusterProgram } from "@forma-language/forma/cluster";

const result = generateClusterProgram(source, { sourceId: "account.lisp" });
if (!result.ok) throw new Error(result.diagnostics.map(d => d.message).join("\n"));
// Write result.code to account.ts.
```

For the entity above, the module contains the schemas, one checked function per
message (`accountDeposit`, `accountWithdraw`, `accountBalance`), the
`accountInitial` constant, and:

```ts
export const Account = Entity.make("Account", [
  Rpc.make("Deposit", { success: Schema.Int, payload: Deposit.fields,
    primaryKey: (payload) => payload.key }).annotate(ClusterSchema.Persisted, true),
  // Withdraw likewise, with error: InsufficientFunds
  Rpc.make("Balance", { success: Schema.Int }),
]);

export const AccountLive = Account.toLayer(
  Effect.map(Ref.make(accountInitial), (stateRef) => Account.of({
    Deposit: (request) => accountDeposit(stateRef, request.payload),
    Withdraw: (request) => accountWithdraw(stateRef, request.payload),
    Balance: () => Rpc.fork(accountBalance(stateRef)),
  })),
  { maxIdleTime: "5 minutes" },
);
```

To declare entities alongside RPC groups and HTTP APIs in one module, use
[`generateEffectSystem`](./system.md).

The emitted code is a single line per declaration; it is shown formatted here.
Payloads are emitted as `Schema.Struct.Fields` because `Rpc.make` accepts
`primaryKey` only with a fields record.

## Run with native Effect

```ts
import { Effect, Layer } from "effect";
import { TestRunner } from "effect/cluster";
import { Account, AccountLive } from "./account.js";

const program = Effect.gen(function* () {
  const account = (yield* Account.client)("acct-1");
  yield* account.Deposit({ key: "dep-1", amount: 50 });
  yield* account.Deposit({ key: "dep-1", amount: 50 }); // returns the stored reply
  return yield* account.Balance(); // 50
});

await Effect.runPromise(program.pipe(
  Effect.provide(AccountLive.pipe(Layer.provideMerge(TestRunner.layer))),
));
```

The `cluster-account` conformance harness runs this on `TestRunner` and checks
that a retried keyed deposit runs once, while the same entity without a primary
key deposits twice. Use `SingleRunner.layer` with a `SqlClient` or the socket
and HTTP runners for real deployments; they are native Effect wiring.

## Current limits

- `:storage :memory` is the only storage. State is a `Ref` per entity instance
  and is lost on passivation, rebalancing, or restart. Durable state behind a
  store service is not implemented.
- Transitions are pure. Commands cannot call services, and there is no native
  handler escape hatch yet.
- `WithTransaction`, `Uninterruptible`, shard groups, mailbox options,
  singletons, `ClusterCron`, workflows, and `EntityProxy` are not declared in
  Forma; write them natively.
- Persisted entity and message names are storage identifiers. Renaming them is
  not checked against stored messages.
- Invariant checking over the transition model (RFC 0028) is not implemented.
