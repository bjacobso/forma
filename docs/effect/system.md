# One Effect system from several preludes

`generateEffectSystem` checks one program that mixes ordinary Effect
declarations with the [RPC](./rpc.md), [HTTP API](./http-api.md), and
[Cluster](./cluster.md) preludes, and emits one native **Effect 4.1.1**
module. It also returns the program's structure as a graph: services, layers,
operations, schemas, errors, and each library's declarations, with the
relations between them.

Each library is an extension of one linker: a prelude plus hooks that check its
declarations, emit native code, and add its graph nodes. `generateRpcProgram`,
`generateHttpApiProgram`, and `generateClusterProgram` are that linker with one
extension. The mechanics checker has no RPC, HTTP, or Cluster cases.

## One domain, three interfaces

```lisp
(type AccountId (Brand String))
(type Amount (Int :min 1 :max 1000))
(type Balance {:id AccountId :balance Int})
(type Deposit {:key String :amount Amount})
(error AccountNotFound {:id AccountId} :status 404)
(service Ledger (: find (-> AccountId (Effect Balance [AccountNotFound]))))

(: lookup (-> {:params {:id AccountId}} (Effect Balance [AccountNotFound] [Ledger.find])))
(define lookup [request] (do! [balance (Ledger.find request.params.id)] balance))

(rpc-group LedgerRpc
  (rpc "GetBalance" :payload {:id AccountId} :success Balance :error AccountNotFound))

(api Bank
  (group accounts
    (endpoint get-balance :get "/accounts/:id"
      :params {:id AccountId} :success Balance :errors [AccountNotFound])))
(handle Bank accounts (handler get-balance lookup))

(entity Account
  :state {:balance Int}
  :initial {:balance 0}
  :storage :memory
  :accept-state-loss true
  (command Deposit :payload Deposit :success Int
    :delivery :persisted :dedupe-by :key
    :update {:balance (+ state.balance amount)}
    :reply state.balance)
  (query Balance :success Int :reply state.balance))
```

```ts
import { generateEffectSystem } from "@forma-language/forma/effect-system";

const result = generateEffectSystem(source, { sourceId: "bank.lisp" });
if (!result.ok) throw new Error(result.diagnostics.map(d => d.message).join("\n"));
// Write result.code to bank.ts; inspect result.system.
```

The module defines each schema, error, and service once, then `LedgerRpc`
(`RpcGroup.make`), `Bank` and `BankAccountsLive` (`HttpApi.make`,
`HttpApiBuilder.group`), and `Account` and `AccountLive` (`Entity.make`,
`Entity.toLayer`). Each import is emitted only when the generated code uses it.

Every rule of each prelude still applies, and the program is checked once. The
linker also rejects two libraries deriving the same export: an entity named
`ShopUsers` and `(handle Shop users ...)` both derive `ShopUsersLive`, and the
second is reported at its declaration.

## Libraries selected by file imports

File modules select their libraries lexically, using the same named or namespace
import syntax as `forma:kernel`:

```lisp
; domain.lisp
(export Greeting)
(type Greeting {:message String})
```

```lisp
; rpc.lisp
(import "./domain.lisp" [Greeting])
(import "forma:effect/rpc" [rpc-group rpc])
(export Greetings)
(rpc-group Greetings (rpc "Greet" :payload String :success Greeting))
```

The other bundled specifiers are `forma:effect/http-api` and
`forma:effect/cluster`. Importing a library enables its descriptors in that file;
a dependency's imports do not enable them in its consumers. Missing imports and
unknown library names produce located diagnostics. Plain `forma check rpc.lisp`
checks the domain and RPC contracts without host flags.

```ts
import { resolveModuleGraph, sourceModuleResolver } from "@forma-language/forma/modules";
import { generateEffectSystem } from "@forma-language/forma/effect-system";

const graph = resolveModuleGraph(
  { id: "rpc.lisp", source: rpcSource },
  sourceModuleResolver([{ id: "domain.lisp", source: domainSource }]),
);
const result = generateEffectSystem(graph);
// Write each result.modules entry's code to its fileName; inspect result.system.
```

Each source module emits once. Forma file imports become real ES imports of the
owning generated module, so RPC and HTTP contracts share domain schema values.
The existing `moduleOutputName` mapping encodes the module ID's UTF-8 bytes as
`module_<hex>.ts`; ES imports use its `.js` counterpart. Resolved identities keep
same-spelled declarations in different files distinct. Authored exports also have
readable TypeScript aliases, including a library declaration's derived exports.
The [HTTP/RPC example](https://github.com/bjacobso/forma/tree/main/examples/http-rpc)
presents its three known outputs as `domain.ts`, `http.ts`, and `rpc.ts` by
remapping these filenames and import paths in its generator.

## The system graph

`result.system` has `nodes` and `edges`. A node id is `kind:name`; child names
are qualified by their parents. For the program above it includes:

| Edge | From the |
| --- | --- |
| `operation:lookup requires service:Ledger` | operation's inferred requirements |
| `operation:lookup raises error:AccountNotFound` | operation's inferred errors |
| `endpoint:Bank/accounts/get-balance handled-by operation:lookup` | HTTP handler binding |
| `rpc:LedgerRpc/GetBalance raises error:AccountNotFound` | RPC contract |
| `entity:Account contains message:Account/Deposit` | entity declaration |
| `message:Account/Deposit implemented-by operation:accountDeposit` | generated transition |

Nodes carry their source span, and some carry data: an operation's
capabilities, or a message's kind, delivery, and dedupe key. Edges whose
endpoints are not declared in the program are dropped.

The [`effect-system-bank`](https://github.com/bjacobso/forma/tree/main/conformance/effect-typescript/cases/effect-system-bank)
conformance case serves this program over HTTP, through `RpcTest`, and on the
Cluster `TestRunner`, using one `Ledger` implementation.

## Current limits

- The extensions are RPC, HTTP API, and Cluster. Elm and email still have their
  own linkers.
- Standalone source strings without module directives retain the `extensions`
  option and the dedicated generators. File-module graphs select libraries by
  import. These adapters still emit TypeScript; an output-neutral adapter API
  is not implemented.
- The graph describes the program; nothing consumes it yet. It is not a
  deployment manifest, and runners, transports, and storage remain native
  Effect wiring.
