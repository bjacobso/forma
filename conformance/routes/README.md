# Routes: a library computes a checked contract

`preludes/routes.forma` is an ordinary, explicitly imported macro library.
There is no route-specific compiler code or host-side generator. It demonstrates
the route/format idea from the Blood syntax examples: author a template once,
compute its required fields while expanding the program, then let Forma's
ordinary record checker enforce those fields at uses of the derived function.

## Use it

From a file beside these fixtures:

```lisp
(import "../../preludes/routes.forma" [route])
(export post-url)

(route post-url ["users" [:id] "posts" [:post]])
(post-url {:id "alice" :post "intro"})
; => "/users/alice/posts/intro"
```

The macro computes this structural function contract from the capture keywords:

```lisp
(-> {:id String :post String} String)
```

Strings (or String expressions) are literal path segments; a singleton vector
containing a keyword is a required String capture. Keywords avoid treating
capture names as variable references. Changing the template changes the contract,
including across an import of the generated builder. Repeated captures reuse
one required field, and `[]` derives `(-> {} String)` and builds `"/"`.
Export generated builders explicitly, just like ordinary functions.

The macro's `filter`/`reduce` compute the record type syntax during expansion;
its emitted function is checked against that type. Macro implementation bodies
themselves are evaluated, not proven type-safe. `sym "->"` constructs the core
type-arrow datum rather than resolving the threading macro of the same spelling.

## Compile-time failures

| Fixture | Rejection | Exact diagnostic span |
| --- | --- | --- |
| `missing.forma` | Required `:post` is absent | `{:id "alice"}` |
| `wrong-type.forma` | `Int` supplied for a String capture | `42` |
| `typo.forma` | `params has no field poost (did you mean post?); fields: id, post` | `(get params :poost)` |
| `wrong-segment.forma` | Non-capture segment must be String | Whole authored `route` call |

The typo fixture first passes `params` to `post-url`, so the field-access checker
learns its closed record contract from the generated function. The error is not
a custom check for the spelling `poost`. All diagnostic offsets and source IDs
above are asserted in `packages/ts/test/routes.test.ts`.

Malformed template shapes (a string instead of the outer vector, or a capture
without exactly one keyword) are also rejected. These currently throw expansion
errors rather than returning the structured, token-located checker diagnostics
in the table. They are not a claim of Blood-quality DSL parser diagnostics.

## Runtime boundary

The emitted builder concatenates `/` and its segments in the ordinary Forma
module evaluator. Tests execute it there, independently of compile-time data
inspection, and check asymmetric field values, another template with different
field names, root routes, and repeated captures. Values such as `"bob%20smith"`
are preserved verbatim. Callers must supply already URL-encoded path segments;
the builder does **not** encode, validate, or parse URLs, perform HTTP requests,
or validate unchecked external data. Its type contract enforces String, not a
refinement excluding `/`, `?`, or `#`.

## Correspondence and limits

This is the same **source template → computed contract → checked use** idea as
Blood's route and named-format examples, using Forma syntax and existing macros.
It deliberately builds URLs rather than implementing Blood's `route.parse`.
It does not implement regex capture extraction, SQL/schema checking, typed
format strings, integer refinements, or `partial(User)`.

In particular this is **not** a universal `(-> String Type)` primitive. The
macro constructs ordinary type syntax, not a first-class type returned by an
arbitrary checked function. Existing macro helpers expose vector items and symbol
names, but no string-literal datum extractor; this example uses structured
templates rather than adding machinery to parse `"/users/:id"`. In this
macro-only approach, a literal string parser would require that missing access;
a descriptor-based DSL would be a different staging approach.

The builder has a structural record parameter, not a newly named generated
`PostParams` alias. An initial implementation emitting `(do (type ...) (: ...)
(define ...))` hit module resolution: declarations nested in the expansion's
`do` are not introduced as top-level module bindings. Explicit authored type
references are also resolved before macro-introduced declarations. This example
avoids those limits without changing the module resolver.

Unlike the separate portable-record trial, this library has no closed JavaScript
emitter and makes no TS/Go backend or general typed-macro claim.

## Run

From the repository root:

```sh
pnpm --filter @formalang/ts exec vitest run test/routes.test.ts
```

The positive and negative fixtures are ordinary file modules; supply this prelude
and the fixture sources to `resolveModuleGraph`/`sourceModuleResolver`, then call
`checkModuleGraph`. `ModuleRuntime` executes the valid graph. The test is a small
complete example of that host setup; no legacy prelude bootstrap is needed.
