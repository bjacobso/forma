# Forma

Forma is a programmable type system for Lisp. Preludes define typed forms
such as `entity`, `endpoint`, or `rule` that take part in checking, and one
checker decides what a well-typed program means for that domain. A Forma
program can evaluate to a value or elaborate into a typed description that
another system validates, reviews, and executes.

Lisp makes a new keyword cheap and a new typing rule expensive, so every team
ends up with a language only its authors understand. Forma lets those
languages multiply and makes them agree underneath: one type language, one
effect system, and one contract format.

> [!IMPORTANT]
> Forma is a pre-alpha research project. The implementation is real and tested,
> but its APIs, package boundaries, and wire formats are still evolving.

Forma source files use `.lisp`; project metadata uses `forma.json` and `forma.lock`.

The compiler keeps every stage visible: lossless reading, macro expansion,
type inference, evaluation, elaboration, and artifact emission. Domain concepts
arrive through ordinary Forma preludes instead of being built into the language
core.

The documentation site can be started locally with `pnpm docs:dev`. Use
`pnpm docs:build` to produce the static site in `dist-docs/`. Homepage code
samples in `docs/snippets/home/` are generated from real engine output; run
`pnpm --filter @formalang/website snippets:home` after changing them.

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
(type (Maybe a) (Tagged (Some a) None))
(match (Some 1)
  (Some x) x
  None 0)
```

Macros are Forma code that produces Forma code:

```lisp
(macro (when test body ...)
  `(if ~test (do ~@body) nil))
```

Type errors remain attached to author-written source:

```lisp
(+ 1 "nope")
; Argument 2 to +: Type mismatch: String vs Float
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
- **One kernel, many spellings.** Clojure spellings (`defn`, `if-let`, `->`)
  are an ordinary macro library over Forma's semantics, and
  [RFC 0021](docs/rfcs/0021-languages-as-libraries.md) proposes making every
  surface a library. Coding agents write those idioms out of habit; whether
  accepting them reduces repair rounds has not been measured yet.
- **One embeddable engine.** The TypeScript/Effect implementation runs in Node,
  browsers, the language server, and the host's JSON CLI. Conformance fixtures
  and stored goldens pin its behavior.

Operational effects make authority visible in the type:

```lisp
(error ConsoleUnavailable {:message String})
(service Console
  (: print (-> String (Effect Unit [ConsoleUnavailable]))))
(: log (-> String (Effect Unit [ConsoleUnavailable] [Console.print])))
(define log [message]
  (do! [_ (Console.print message)] nil))
```

The checker infers this contract:

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
(entity Department {:name String})
(entity Employee {:name String
                  :department (Option (Id Department))
                  :active (Option Bool)})
(query employee-directory :from Employee
  :where active :select [name department])
```

`entity` is not a compiler special case. The ontology prelude describes
it with `form`; this is an abridged excerpt of the registered descriptor:

```lisp
(type EntityIR {:kind "Entity" :name Symbol :fields (List EntityFieldIR)})
(form (entity name fields)
  :types {:name (Declares SchemaDecl) :fields (Record Type)}
  :ir EntityIR
  {:kind "Entity" :name name :fields (fields->ir name fields)})
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
(type CartId (Brand String))
(type CustomerId (Brand String))
(type CheckoutRequest {:cart-id CartId
                       :customer-id CustomerId
                       :coupon (Option String)
                       :lines (List CheckoutLine)})
(error CheckoutRejected {:reason String})
(service CartRepo
  (: load (-> CheckoutRequest (Effect Cart [CheckoutRejected]))))
(: checkout
  (-> CheckoutRequest
      (Effect CheckoutResult [CheckoutRejected]
        [CartRepo.load Pricing.price Orders.create])))
(define checkout [request]
  (do! [cart (CartRepo.load request)
        priced (Pricing.price cart request)
        order (Orders.create priced)]
    order))
```

The generator is available through the public distribution API.
`generateEffectProgram` reads, projects, checks, and generates in one call, and
returns located diagnostics instead of code when the program does not check:

```ts
import { generateEffectProgram } from "@forma-language/forma/mechanics";

const result = generateEffectProgram(source, { sourceId: "checkout.lisp" });

if (!result.ok) {
  throw new Error(
    result.diagnostics
      .map(({ span, message }) => `${span?.startLine}:${span?.startColumn} ${message}`)
      .join("\n"),
  );
}

const { code, operationNames } = result;
```

Selected lines from the generated preview (abridged, with declarations between
the excerpts omitted) are:

```ts
import { Context, Effect, Schema } from "effect";

export const CartId = Schema.String.pipe(Schema.brand("CartId"));
export type CartId = typeof CartId.Type;

export const CheckoutRequest = Schema.Struct({
  "cart-id": CartId,
  "customer-id": CustomerId,
  coupon: Schema.optionalKey(Schema.String),
  lines: Schema.Array(CheckoutLine),
});
export type CheckoutRequest = typeof CheckoutRequest.Type;

export class CheckoutRejected extends Schema.TaggedError<CheckoutRejected>()("CheckoutRejected", {
  reason: Schema.String,
}) {}

export class CartRepo extends Context.Service<
  CartRepo,
  {
    readonly load: (request: CheckoutRequest) => Effect.Effect<Cart, CheckoutRejected>;
  }
>()("CartRepo") {}

export const checkout = (
  request: CheckoutRequest,
): Effect.Effect<CheckoutResult, CheckoutRejected, CartRepo | Orders | Pricing> =>
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

Layers, resources, concurrency, typed error recovery, configuration, and
streams are covered as well. [Forma for Effect](docs/effect.md) explains the
benefits and the costs, and the [Effect reference](docs/effect/reference.md) lists
the whole surface. The [Effect TypeScript conformance suite](conformance/effect-typescript)
generates, typechecks, and runs a set of complete programs and records how
Forma rejects incorrect ones.

Run `pnpm dev` and open `/playground/demo/effect-ts` to edit this program and inspect its
generated target. The sibling `/playground/demo/effect-schema` pipeline uses
`generateMechanicsEffectSchemaModule` to produce Effect Schema declarations.
The Effect TypeScript generator throws when a body node has no translation;
it does not emit a placeholder program.

## Quick start

Use Node.js 24. The public distribution is `@forma-language/forma` 0.6.0, with
Effect as a required peer:

```sh
npm install @forma-language/forma effect
```

This installs the language and runtime without editor, MCP or language-server
libraries. For `forma mcp`, add `@modelcontextprotocol/sdk@1.32.2`. For
`forma-language-server`, add `vscode-languageserver@^9.0.1` and
`vscode-languageserver-textdocument@^1.0.12`. Editor adapters use optional
CodeMirror/Lezer peers; `/editor/react` also needs React and React DOM 19.
See [optional tooling installation](packages/forma/README.md#optional-tooling)
for the full package lists and commands. UI-free `/editor` needs no extra peers.

Or, from a source checkout with pnpm 10.20:

```sh
pnpm install --frozen-lockfile
pnpm exec turbo run build --filter=@forma-language/forma
alias forma="node $PWD/packages/forma/dist/cli.mjs"
```

Save `(+ 20 22)` as `main.lisp`, then check and run it (with an npm local
install, use `npx forma` in place of `forma`):

```sh
forma check main.lisp
forma run main.lisp
# 42
```

Continue with [Authoring](docs/authoring.md), the standalone
[project example](examples/project/README.md), or [Embedding](docs/embedding.md)
and the [Node app](examples/embed-node/README.md). The experimental embedding
facade checks and runs programs without Effect imports.

Run `pnpm check:examples` to exercise both examples against a packed tarball
installed offline in temporary projects. For local demos use `pnpm dev`;
`pnpm check` verifies the workspace and docs. See [AGENTS.md](AGENTS.md)
for contributor commands. The frozen install needs no sibling checkout or link step.

## Documentation and examples

- [Vision](docs/vision.md) explains the problem Forma is designed to solve.
- [Architecture](docs/architecture.md) describes the engine, the host boundary,
  and tooling.
- [Language guide](docs/language.md) introduces execution, types, effects, and
  elaboration.
- [Authoring your own program](docs/authoring.md) shows how to check, run, and
  elaborate your own files with the `forma` CLI, and lists the builtins.
- [Design decisions](docs/design-decisions.md) records the constraints behind
  the current architecture.
- [Language services](docs/language-services.md) describes node identity,
  observation, edit scripts, and the outline codec for structural editors.
- [Writing a form](docs/writing-a-form.md) shows how a prelude defines typed
  domain vocabulary, and the [prelude catalog](https://forma-lang.com/preludes/)
  is generated from the prelude sources.
- [File modules](docs/modules.md) covers imports, exports, and offline packages
  through `forma.json`, a verified `forma.lock`, and committed vendor sources.
- [Clojure spellings](docs/clojure.md) shows a checked Clojure-spelled example,
  the errors it refuses to paper over, and its limits.
- [Structure and Interpretation of Forma Programs](docs/structure-and-interpretation.md)
  and [Domain modeling in Forma](docs/domain-modeling.md) are longer guides
  with examples run on the current engine.
- [Roadmap](docs/roadmap.md) tracks the path from the research implementation
  toward a stable language platform.
- [Examples](examples/README.md) contains reviewable domain programs embedded
  in Markdown, while [conformance fixtures](conformance/) pin implemented
  behavior.

## Workspace

| Project | Purpose |
| --- | --- |
| `@formalang/ts` | TypeScript reader, evaluator, VM, typechecker, and elaborator |
| `@formalang/host` | Host ABI, JSON CLI, and daemon over the TypeScript engine |
| `@formalang/editor` | CodeMirror and React editing components |
| `@formalang/language-server` | Language Server Protocol implementation |
| `@formalang/website` | Browser-based compiler explorer and project site |
| `conformance/` | Semantic and effect fixtures with stored goldens |

## Runtime configuration

- `FORMA_LANGUAGE_SERVER_PRELUDES` supplies comma-separated, consumer-owned prelude paths.
- `FORMA_LANGUAGE_SERVER_ENABLE_FORMATTING` enables language-server formatting.
- `FORMA_DISABLE_NATIVE_ELABORATION` selects the portable elaboration path.

## Project status

Forma is pre-alpha. Expect APIs, package boundaries, syntax, and artifact
contracts to change while the language model is validated.

Working today: the lossless reader and formatter, typed macros, Hindley–Milner
and effect inference, refined contracts, canonical IR with payload contract
identities, file modules and offline packages, Effect TypeScript and Effect
Schema generation, the browser playground, the language server, and
conformance goldens. Not built yet: a published CLI, a stable host ABI, a
consumer-prelude SDK, the trusted kernel and elaborators
([RFC 0022](docs/rfcs/0022-programmable-type-system.md)), Lisp dialect adapters
and emitters ([RFC 0021](docs/rfcs/0021-languages-as-libraries.md)), Go and
Rust Effect hosts ([Effect hosts](docs/rfcs/0022-effect-hosts.md)), and
effect-polymorphic signatures ([RFC 0023](docs/rfcs/0023-effect-polymorphism.md)). The single public distribution is
`@forma-language/forma`, on npm. Internal workspaces are
private. Changesets manages version PRs and the Release workflow publishes the
validated public package after maintainer authorization. Releases and npm
trusted-publisher setup are described in [Publishing](docs/publishing.md).

## Website deployment

The docs homepage and compiler explorer at `/playground` deploy to
https://forma-lang.com with Alchemy and Cloudflare Workers. After CI succeeds
for a push to `main`, the Deploy workflow builds and deploys that validated
revision, then checks the docs, playground, and legacy workbench redirect.
The structural workbench is deployed by Foldworks. Same-repository pull requests
deploy a `pr-<number>` preview on `workers.dev`, with its URL in one updated PR
comment. Closing the PR destroys its stage and marks the comment as removed.
Forks never deploy. Deploy and cleanup runs serialize per PR so closing a PR
cannot race its deployment.

Configure `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN` in the repository's
GitHub `production` environment. The token needs Workers Scripts Edit, Account
Settings Read, Workers R2 Storage Edit, and Secrets Store Edit on the deployment
account; Zone Read and Workers Routes Edit on `forma-lang.com`. Secrets Store Edit is required to bind
Alchemy's state-store secret to a temporary Worker when CI authenticates; Read
alone does not allow binding. The secret must also have the `workers` scope.
See [Cloudflare's Secrets Store access control](https://developers.cloudflare.com/secrets-store/access-control/).
Alchemy stores deployment state in Cloudflare, shared by local and GitHub
deployments.

For previews, configure `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN` in the
GitHub `preview` environment too. Give the token the account permissions above;
previews do not need zone permissions because they never bind custom domains.
If either secret is absent, the Preview workflow skips deployment and cleanup
with a notice. Configure the environment to allow same-repository PR branches.
Keep production credentials in the separate `production` environment.

Alchemy beta.84 uses `@alchemy.run/cloudflare` and the account's default
`Cloudflare.state()` store, preserving the existing production state. The
bootstrap command is now `pnpm exec alchemy state bootstrap --backend cloudflare`;
deployments pass `--yes` so CI can handle a missing or outdated state store.
The Effect 4.1 crypto compatibility patch and offline deployment checks are
documented in [patches/README.md](patches/README.md).

Use `pnpm website:build` to build, `pnpm website:plan` to inspect infrastructure
changes, and `pnpm website:deploy` to deploy locally with Alchemy credentials.
The `prod` stage owns the custom domain. Other stages use separate Worker
names without binding the production domain. The existing Wrangler config
remains available for `pnpm website:dry-run` in CI.

## License

[MIT](LICENSE)

Part of the [WorldVM](https://worldvm.com) family of experiments.
