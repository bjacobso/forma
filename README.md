# Forma

Forma is a typed, homoiconic Lisp for building domain-specific languages. A
Forma program can evaluate to a value or elaborate into a typed description
that another system validates, reviews, and executes.

> [!IMPORTANT]
> Forma is a pre-alpha research project. The implementation is real and tested,
> but its APIs, package boundaries, and wire formats are still evolving.

The compiler keeps every stage visible: lossless reading, macro expansion,
type inference, evaluation, elaboration, and artifact emission. Domain concepts
arrive through ordinary Forma preludes instead of being built into the language
core.

## Forma at a glance

Functions, collections, and control flow use compact Lisp syntax:

```lisp
(define grade (fn [score]
  (cond
    (>= score 90) "A"
    (>= score 80) "B"
    (>= score 70) "C"
    (>= score 60) "D"
    :else "F")))
(map grade [95 82 75 63 45])
```

Algebraic data types participate in inference and pattern matching:

```lisp
(define-type (Maybe a) (Some a) (None))
(match (Some 1)
  (Some x) x
  (None) 0)
```

Macros are Forma code that produces Forma code:

```lisp
(define-macro when [test & body]
  `(if ~test (do ~@body) nil))
```

Type errors remain attached to author-written source:

```lisp
(+ 1 "nope")
; Type mismatch: Number vs String (at offset 0)
```

## Why Forma

- **Typed macros.** Extend the language without giving up inference or useful
  source diagnostics. Expanded forms retain provenance back to the code an
  author wrote.
- **Elaborator reflection.** Hosts register forms, descriptors, and compile-time
  hooks that turn concise domain syntax into typed IR. The compiler does not
  need to know what an entity, endpoint, policy, or workflow is.
- **Operational effects.** Success values, closed sets of typed failures, and
  required host capabilities remain explicit through inference and portable
  artifacts.
- **Inspectable compilation.** Intermediate forms are a supported product
  surface, not a hidden implementation detail. The browser demos expose each
  pass from source text to target output.
- **Two engines.** The TypeScript implementation is designed for embedding and
  browser tooling. The OCaml engine targets native code, JavaScript, and
  WebAssembly, with shared conformance fixtures defining their semantic
  intersection.

Operational effects make authority visible in the type:

```lisp
(define-error ConsoleUnavailable
  (:fields (field message String)))

(define-service Console
  (:methods
    (print [message String]
      (Effect Unit [ConsoleUnavailable] []))))

(: log (-> String (Effect Unit [ConsoleUnavailable] [Console.print])))
(define-operation log [message]
  (do! [_ (Console.print message)]
    (succeed nil)))
```

Both engines infer the same contract (using their target-specific spelling for
the string type):

```text
String -> Effect<Unit, ErrorSet<ConsoleUnavailable>, RequirementSet<Console.print>>
```

The success value, possible failure, and required `Console.print` capability are
all part of the program's checked interface.

## How compilation works

Forma separates language machinery from consumer-defined vocabulary:

```text
source
  → lossless read / parse
  → macro expansion
  → core lowering
  → type inference
  → evaluation or elaboration
  → typed artifact packaging
  → JSON ABI / target backend
```

Evaluation computes a value. Elaboration recognizes registered forms and
projects them into domain IR while preserving types, diagnostics, and source
spans. A prelude teaches the compiler a form's identifiers and slots, the
bindings it introduces, its validation rules, its result type, and the hook
that constructs its output.

### An elaboration walkthrough

Consider this real conformance fixture. It defines two entity schemas and a
query over one of them:

```lisp
(define-entity Department
  (:field [department/name String {:required true}]))

(define-entity Employee
  (:field [employee/name String {:required true}])
  (:field [employee/department (Ref Department)])
  (:field [employee/active Bool]))

(define-query employee-directory
  (:from Employee)
  (:where employee/active)
  (:select [employee/name employee/department]))
```

`define-entity` is not a compiler special case. The ontology prelude describes
it with `define-form`; this is an abridged excerpt of the registered descriptor:

```lisp
(define-form define-entity
  (:phase domain)
  (:identifiers
    (identifier name Symbol (:declaration true)))
  (:slots
    (slot field value
      (:many true)
      (:required true)
      (:child-form field)
      (:child-identifier name Value)
      (:child-slot type expr (:positional true))))
  (:bindings-fn entity/bindings)
  (:construct-fn entity/construct)
  (:construct
    [kind "Entity"]
    [name (or declaration-name "anonymous-entity")]
    [fields (entity-fields field)])
  (:declaration-type (row))
  (:result-type (constant SchemaDecl)))
```

The descriptor registry supplies compile-time hooks for bindings, validation,
construction, and result types. For the query, those hooks resolve `Employee`,
check that `:where` is boolean, project the selected row fields, and construct
canonical query IR. Selected declarations from the emitted artifact are:

```json
[
  {
    "fields": [
      {
        "name": "employee/name",
        "required": "true",
        "type": "String"
      },
      {
        "name": "employee/department",
        "required": null,
        "type": ["Ref", "Department"]
      },
      {
        "name": "employee/active",
        "required": null,
        "type": "Bool"
      }
    ],
    "kind": "Entity",
    "name": "Employee"
  },
  {
    "from": "Employee",
    "kind": "Query",
    "name": "employee-directory",
    "select": ["employee/name", "employee/department"],
    "where": "employee/active"
  }
]
```

See the complete [fixture](conformance/fixtures/canonical-ir/schema.lisp),
[expected artifact](conformance/fixtures/canonical-ir/expected.json), and
[ontology prelude](preludes/ontology.lisp) for the full path. The live compiler
explorer started by `pnpm dev` makes the same passes visible in the browser.

## Generate Effect TypeScript

Forma mechanics declarations can generate services and programs for the
[Effect](https://effect.website/) TypeScript ecosystem. The website's checkout
demo defines schemas, typed errors, services, and an operation with
operation-granular requirements. This excerpt is abridged; the
[pipeline source](apps/website/src/pipelines/index.ts) contains every schema and
service declaration.

```lisp
(define-schema CheckoutRequest
  (Struct
    (field cart-id (Brand CartId String))
    (field customer-id (Brand CustomerId String))
    (field coupon (Optional String))
    (field lines (Array CheckoutLine))))

(define-error CheckoutRejected
  (:fields
    (field reason String)))

(define-service CartRepo
  (:methods
    (load [request CheckoutRequest]
      (Effect Cart [CheckoutRejected] []))))

(: checkout
  (-> CheckoutRequest
      (Effect CheckoutResult
        [CheckoutRejected]
        [CartRepo.load Pricing.price Orders.create])))
(define-operation checkout [request]
  (do!
    [cart (<- (CartRepo.load request))
     priced (<- (Pricing.price cart request))
     order (<- (Orders.create priced))]
    (succeed order)))
```

The generator is available through the workspace package's public API:

```ts
import { Effect } from "effect";
import {
  generateMechanicsEffectTypeScriptModule,
  mechanicsPackageableDeclarations,
} from "@forma/ts/mechanics";
import { parseManyToSExpr } from "@forma/ts/reader";

const forms = Effect.runSync(parseManyToSExpr(source));
const projected = mechanicsPackageableDeclarations(forms, "checkout.forma");

if (!projected.ok) {
  throw new Error(projected.diagnostics.map(({ message }) => message).join("\n"));
}

const { code, operationNames } =
  generateMechanicsEffectTypeScriptModule(projected.declarations);
```

Selected lines from the generated preview (abridged, with declarations between
the excerpts omitted) are:

```ts
import { Context, Effect } from "effect";

type Brand<Name extends string, Type> = Type & { readonly "__brand": Name };
export type CartId = Brand<"CartId", string>;
export type CustomerId = Brand<"CustomerId", string>;

export interface CheckoutRequest {
  readonly "cart-id": CartId;
  readonly "customer-id": CustomerId;
  readonly coupon?: string;
  readonly lines: ReadonlyArray<CheckoutLine>;
}

export interface CheckoutRejected {
  readonly _tag?: "CheckoutRejected";
  readonly reason: string;
}

export class CartRepo extends Context.Tag("CartRepo")<
  CartRepo,
  {
    readonly load: (request: CheckoutRequest) => Effect.Effect<Cart, CheckoutRejected>;
  }
>() {}

  Effect.gen(function* () {
    const cartRepo = yield* CartRepo;
    const orders = yield* Orders;
    const pricing = yield* Pricing;
    const cart = yield* cartRepo.load(request);
    const priced = yield* pricing.price(cart, request);
    const order = yield* orders.create(priced);
    return order;
  });
```

Run `pnpm dev` and open `/demo/effect-ts` to edit this program and inspect its
generated target. The sibling `/demo/effect-schema` pipeline uses
`generateMechanicsEffectSchemaModule` to produce Effect Schema declarations.

## Quick start

Forma requires Node.js 24 and pnpm 10.20.

```sh
pnpm install --frozen-lockfile
pnpm test
pnpm dev
```

The website and live compiler demos run at the Vite URL printed by `pnpm dev`.
There is currently no published `forma` CLI or npm release: work from this
repository, embed its workspace packages, or build the OCaml engine locally.

The OCaml engine additionally requires OCaml 5.2, Dune, `js_of_ocaml`, and
`wasm_of_ocaml`:

```sh
mise install
mise run forma:ocaml:test
```

## Documentation and examples

- [Vision](docs/vision.md) explains the problem Forma is designed to solve.
- [Architecture](docs/architecture.md) describes engines, the host boundary,
  and tooling.
- [Language guide](docs/language.md) introduces execution, types, effects, and
  elaboration.
- [Design decisions](docs/design-decisions.md) records the constraints behind
  the current architecture.
- [Roadmap](docs/roadmap.md) tracks the path from the research implementation
  toward a stable language platform.
- [Examples](examples/README.md) contains reviewable domain programs embedded
  in Markdown, while [conformance fixtures](conformance/) pin behavior shared
  by both engines.

## Workspace

| Project | Purpose |
| --- | --- |
| `@forma/ts` | TypeScript reader, evaluator, VM, typechecker, and elaborator |
| `@forma/ocaml` | Native/JavaScript/WebAssembly compiler and interpreter engine |
| `@forma/host` | Shared host ABI across engine implementations |
| `@forma/editor` | CodeMirror and React editing components |
| `@forma/language-server` | Language Server Protocol implementation |
| `@forma/website` | Browser-based compiler explorer and project site |
| `conformance/` | Cross-engine semantic and effect fixtures |

## Runtime configuration

- `FORMA_OCAML_CLI` overrides the native `forma_cli` artifact.
- `FORMA_OCAML_JS` overrides the JavaScript OCaml artifact.
- `FORMA_LANGUAGE_SERVER_ARTIFACT` overrides the language-server engine artifact.
- `FORMA_LANGUAGE_SERVER_PRELUDES` supplies comma-separated, consumer-owned prelude paths.
- `FORMA_LANGUAGE_SERVER_ENABLE_FORMATTING` enables language-server formatting.
- `FORMA_DISABLE_NATIVE_ELABORATION` selects the portable elaboration path.
- `FORMA_DAEMON_TIMEOUT_MS` controls native daemon request timeouts.

## Project status

Forma is pre-alpha. Expect APIs, package boundaries, syntax, and artifact
contracts to change while the language model is validated. Package names
reserve the intended `@forma` surface, but nothing in this repository is
published automatically.

## Website deployment

The docs and compiler explorer deploy to https://forma-lang.com with Alchemy
and Cloudflare Workers. After CI succeeds for a push to `main`, the Deploy
workflow builds and deploys that validated revision, then checks the home,
about, and demo pages. Pull requests do not deploy.

Configure `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN` in the repository's
GitHub `production` environment. Match the Triplex/Foldworks token permissions:
Workers Scripts edit, Account Settings read, and Secrets Store read on the
deployment account; Zone read and Workers Routes edit on `forma-lang.com`.
Alchemy stores deployment state in Cloudflare, shared by local and GitHub
deployments.

Use `pnpm website:build` to build, `pnpm website:plan` to inspect infrastructure
changes, and `pnpm website:deploy` to deploy locally with Alchemy credentials.
The `prod` stage owns the custom domain. Other stages use separate Worker
names without binding the production domain. The existing Wrangler config
remains available for `pnpm website:dry-run` in CI.

## License

[MIT](LICENSE)
