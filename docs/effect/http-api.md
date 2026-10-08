# Prelude-defined HTTP APIs

`preludes/http-api.lisp` is a declaration DSL targeting
`effect@4.0.0-rc.112` and `effect/unstable/httpapi`. Its `form` declarations
define syntax, typed IR, and TypeScript emission together. A second generator
derives a TypeScript builder DSL from those same declarations.

This is a first spike. Bootstrap it independently of the ontology prelude,
which has an older `api` form for portable HTTP descriptions.

## Write an API in Forma

```lisp
(type UserId (Brand String))
(type User {:id UserId :name String})
(error UserNotFound {:id UserId} :status 404)
(service UserRepo (: find (-> UserId (Effect User [UserNotFound]))))

(: lookup (-> {:params {:id UserId}}
              (Effect User [UserNotFound] [UserRepo.find])))
(define lookup [request]
  (do! [user (UserRepo.find request.params.id)] user))

(api Shop
  (group users
    (endpoint get-user :get "/users/:id"
      :params {:id UserId} :success User :errors [UserNotFound])))
(handle Shop users (handler get-user lookup))
```

`params` follows Effect 4's spelling for path parameters. Endpoint and group
identifiers retain their authored names, including hyphens. Methods are
`:get`, `:post`, `:put`, `:patch`, and `:delete`. Payload schemas are supported
on the three body methods. `success` is required; `params`, `payload`, and
`errors` are optional.

Handlers are ordinary Forma operations accepting one request record. The
linker checks the request, success type, and declared error set against the
endpoint. An undeclared handler failure is reported on its `handler` form.
Every endpoint in a handled group must have exactly one handler.

```ts
import { generateHttpApiProgram } from "@formalang/ts/http-api";

const result = generateHttpApiProgram(source, { sourceId: "shop.forma" });
if (!result.ok) throw new Error(result.diagnostics.map(d => d.message).join("\n"));
// Save result.code as shop.ts. It imports Effect, with no Forma runtime.
```

The output exports `Shop` and the handler layer `ShopUsersLive`, alongside the
schemas, errors, services, and operations. Error `:status` metadata becomes
an HTTP schema annotation. Serve it using the pinned Effect APIs:

```ts
import { Layer } from "effect";
import { HttpRouter, HttpServer } from "effect/unstable/http";
import { HttpApiBuilder } from "effect/unstable/httpapi";
import { Shop, ShopUsersLive } from "./shop.js";

const routes = HttpApiBuilder.layer(Shop).pipe(
  Layer.provide(ShopUsersLive),
  HttpRouter.provideRequest(UserRepoLive), // Your repository implementation layer.
  Layer.provide(HttpServer.layerServices),
);
const { handler, dispose } = HttpRouter.toWebHandler(routes);
```

## Generate a TypeScript DSL

```ts
import { writeFileSync } from "node:fs";
import { generateHttpApiBuilders } from "@formalang/ts/http-api";

writeFileSync("http-builders.ts", generateHttpApiBuilders().code);
```

The generated factories accept existing Effect schemas:

```ts
import { Schema } from "effect";
import { Api, Group, Endpoint } from "./http-builders.js";
import { User, UserId, UserNotFound } from "./shop.js";

const shop = Api.make("Shop").add(
  Group.make("users").add(
    Endpoint.get("get-user", "/users/:id", {
      params: Schema.Struct({ id: UserId }),
      success: User,
      errors: [UserNotFound.annotate({ httpApiStatus: 404 })],
    }),
  ),
);
// shop.value is the native Effect HttpApi; names and schema types accumulate.
// shop.ir is the projected structure, with live Schema values in Type holes.
```

Builders are immutable. Start a group or API with `.make(name)` and add at
least one child before accessing `.value`. Endpoint factories include `get`,
`post`, `put`, `patch`, and `delete_`. Use `.value` with native Effect handlers,
clients, and `.pipe(...)`. `.reference` returns a typed declaration reference
for generated forms with `(Refers DeclarationKind)` holes.

The builder IR has the same declared record shape as Forma's wire IR. Its
Type holes contain live schemas rather than serialized Forma type syntax;
it is an inspection value, not a portable artifact. The emitted Forma program
still packages under the derived IR contracts.

## Author emitters and builders

Add `:emit` to an ordinary form. It receives projected IR and returns a
quasiquoted TypeScript expression:

```lisp
(form (message name text)
  :types {:name (Declares Message) :text String}
  :ir MessageIR
  :emit (fn [ir] `(Messages.make ~(get ir :name) ~(get ir :text)))
  {:kind "Message" :name name :text text})
```

`emitFormTypeScript` in `@formalang/ts/descriptor-codegen` evaluates the hook.
Symbols in its output name target bindings; strings and keyword map labels
are escaped as TypeScript literals. `ts/ref` constructs a validated target
reference. `ts/schema` lowers a Forma Type hole; `ts/schemas` lowers a list of
schemas; `ts/children` recursively invokes child emitters. `ts/method` and
`ts/arrow` describe method calls and arrow functions, and `ts/chain` composes
child method expressions over a named base. Pure helpers and macros may be
used inside emit hooks.

`generateFormBuilders` derives literal name parameters from `Declares`,
typed references from `Refers`, Schema parameters from `Type` and `Record
Type`, optional fields from `Option`, and method variants from keyword unions.
A `(form name child ...)` pattern generates `.add()` accumulation. Target
type refinements describe native constraints and generics; the target
expressions still come from the Lisp hooks.

Builder derivation currently requires projections made from record literals,
literal values, and hole references. It rejects executable `:check`, `:scope`,
computed `:type`, expression holes, and unsupported projection expressions.
Those rules continue to work during Forma elaboration; they are not silently
dropped from a derived builder.

The operational combinators still use the existing mechanics compiler.
Middleware, query/header schemas, streaming endpoints, inline Forma handler
bodies, and imported compile-time libraries remain outside this spike. Both
engines accept `:emit` metadata; emission and builder derivation currently run
through the TypeScript host.

The `http-api` conformance case golden-tests both generated modules, checks
them with strict TypeScript and the suite's escape detector, validates the IR
artifact, and serves GET and POST requests. Its harness also checks a typed
404, malformed payload rejection, and the generated builder's handler types.
