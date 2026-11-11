---
title: Domain modeling in Forma
description: Design a business workflow with types, in the style of Domain Modeling Made Functional. Simple types, choices, constrained values, state transitions, workflows as pipelines, typed errors, explicit dependencies, and serialization, all checked and compiled to Effect TypeScript.
---

# Domain modeling in Forma

This guide follows the approach of Scott Wlaschin's *Domain Modeling Made
Functional*. Learn the domain from the people who work in it. Write down what
they told you as types. Implement each business process as a pipeline of
functions whose signatures state what the process needs, produces, and can
fail with. Keep I/O at the edges.

In TypeScript, much of that discipline is convention: branded types, tagged
unions, and an `Effect` return type you remember to write. In Forma, the
domain model is written in the language itself:

- `type` declares values, records, and choices, which become Effect `Schema`
  definitions.
- `error` declares failures the business cares about.
- `service` declares dependencies.
- Every operation has a signature that lists its success value, its errors,
  and the capabilities it uses.

The checker holds every function body to its signature. The compiler generates
the Effect TypeScript you would have written by hand.

The running example is one complete program. It passes Forma's Effect checker,
and the generated module passes the repository's strict TypeScript settings.
The behavior described below was run against test services. Forma is
pre-alpha, and the last section lists what the model can't express yet.

> To follow along, paste the code into the
> [Effect playground](https://forma-lang.com/playground/demo/effect-ts), or
> call `Mechanics.generateEffectProgram(source)` from `@formalang/ts`. The
> [Effect reference](./effect/reference.md) documents every form used here.

## 1 Understanding the domain

Larkspur Roasters sells coffee wholesale to cafés. Here is how the order desk
describes its work:

> A café sends us an order form. It has the café's account ID, an email
> address for the order, and one or more lines. Each line is a product SKU, a
> number of bags, and a grind: whole bean, espresso, or filter. The café either
> picks the order up at a roastery or has it couriered to an address. We check
> that the café has an account, price each line from the catalog, and add
> shipping. Courier delivery is free from twenty bags; below that it's a flat
> fee plus a charge per bag. Then we email an acknowledgment and ask billing to
> send an invoice.

Before writing any code, find the structure in that paragraph:

- **A workflow**: *place order*. It is triggered by a command (an order form
  arrives) and ends in events: *order placed*, *invoice requested*, and, when
  the email went out, *acknowledgment sent*.
- **Bounded contexts.** Order taking owns this workflow. Billing and shipping
  are other contexts. They learn about orders through events, not by reaching
  into order taking's data.
- **The ubiquitous language**: café, line, SKU, bags, grind, pickup, courier,
  shipping. Use these words for names in the code too. A domain expert should
  be able to read the types.

Sketch the workflow in plain text before you write types:

```text
workflow: place order
  input:   an order form (not yet trusted)
  output:  OrderPlaced, InvoiceRequested,
           AcknowledgmentSent (only if the email went out)
  errors:  form is malformed, order is empty, café is unknown, SKU is unknown
  uses:    the café directory, the catalog, the mailer

  steps:
    parse the form           → order form
    validate against business → validated order
    price each line, add shipping → priced order
    send acknowledgment      → sent or not (never fails the order)
    announce events
```

The rest of this guide writes that sketch in Forma, one piece at a time.

## 2 Modeling with types

### Simple values

A café ID and an order ID are both strings, but they are not interchangeable.
A **brand** gives a value its own type, with no runtime cost:

```lisp
(type CafeId (Brand String))
(type OrderId (Brand String))
```

Construct a branded value by applying its name, as in `(CafeId "cafe:north")`.
A function that expects a `CafeId` rejects an `OrderId`:

```text
mechanics/type-mismatch: Expected CafeId, but this is OrderId.
```

### Constrained values

A SKU is not just any string, and an order line can't have zero bags. Forma
types can carry these constraints:

```lisp
(type Sku (String :pattern "^(BEAN|GEAR)-[0-9]{3}$"))
(type Email (String :pattern "^[^@ ]+@[^@ ]+$" :max-length 254))
(type Bags (Int :min 1 :max 200))
(type Cents (Int :min 0))
```

Each refinement becomes an Effect Schema check:

```ts
export const Bags = Schema.Int.check(Schema.isGreaterThanOrEqualTo(1))
  .check(Schema.isLessThanOrEqualTo(200));
```

Know when these checks run. **Refinements are enforced when data is
decoded.** That is the boundary where untrusted input enters the domain
(section 4). Forma does not prove refinements statically. A value computed
inside the program is checked against its base type (`Int`), not its range.
Section 3 shows how to build a smart constructor when you need the check
elsewhere.

### Choices

The domain is full of *or*. A grind is whole bean, espresso, or filter. A
delivery is a pickup or a courier. A simple choice of labels is a union of
keywords. A choice whose cases carry different data is a tagged type:

```lisp
(type Grind (Union :whole-bean :espresso :filter))

(type Delivery
  (Tagged
    (Pickup {:roastery String})
    (Courier {:street String :city String :postcode String})))
```

The tagged type says something a record with optional fields cannot:
a courier delivery always has an address, and a pickup never has one. There
is no "courier with no street" to defend against, because no such value
exists.

### Records

The *and* of the domain is a record. Fields are required unless their type is
`(Option T)`. Here is the order line and the form as the café sends it:

```lisp
(type OrderLineForm {:sku Sku :bags Bags :grind Grind})

(type OrderForm
  {:order-id String
   :cafe String
   :email Email
   :lines (List OrderLineForm)
   :delivery Delivery})
```

An optional field accepts a plain value or an existing `Option`. Copying a
field preserves its absence; `None` omits the generated object's key rather
than storing `undefined`:

```lisp
(type OrderNote {:note (Option String) :revision Int})
(: copy-note (-> OrderNote OrderNote))
(define copy-note [previous]
  {:note (get previous :note) :revision (+ (get previous :revision) 1)})
```

### Each state is its own type

An order is not one record that gains fields as the workflow runs. Each stage
establishes something new, so each stage has its own type:

```lisp
(type ValidatedOrder
  {:id OrderId
   :cafe CafeId
   :email Email
   :lines (List OrderLineForm)
   :delivery Delivery})

(type PricedLine {:sku Sku :bags Bags :grind Grind :line-total Cents})

(type PricedOrder
  {:id OrderId
   :cafe CafeId
   :email Email
   :lines (List PricedLine)
   :delivery Delivery
   :shipping Cents
   :total Cents})
```

A `ValidatedOrder` has a `CafeId`, not a string. That type means "this café
has an account", because the only way the workflow produces a
`ValidatedOrder` is by checking. A `PricedOrder` has a total. Code that needs
a price takes a `PricedOrder` and can't be handed something unpriced: passing
a `ValidatedOrder` where an `OrderForm` is expected is reported as

```text
mechanics/type-mismatch: Expected OrderForm, but this is ValidatedOrder.
```

### Events and errors

The workflow's outputs are events, one constructor per thing that happened:

```lisp
(type OrderEvent
  (Tagged
    (OrderPlaced {:order PricedOrder})
    (InvoiceRequested {:order-id OrderId :cafe CafeId :amount Cents})
    (AcknowledgmentSent {:order-id OrderId :email Email})))
```

Failures the business talks about are declared as errors. They are part of
the model, not exceptions:

```lisp
(error InvalidOrderForm {:reason String})
(error EmptyOrder {:order-id OrderId})
(error UnknownCafe {:cafe CafeId})
(error UnknownSku {:sku Sku})
(error MailerDown)
```

### Dependencies

The workflow needs three things from the outside world. Each is a
**service**, a set of typed operations:

```lisp
(service Cafes (: known (-> CafeId (Effect Bool))))
(service Catalog (: price (-> Sku (Effect (Option Cents)))))
(service Mailer (: send (-> Email String (Effect Unit [MailerDown] []))))
```

`Catalog.price` returns `(Option Cents)`: an unknown SKU is `None`, not
`null`, and every caller has to handle it. `Mailer.send` can fail with
`MailerDown`, and its type says so.

### The workflow as a type

Now the whole workflow fits in one signature:

```lisp
(: place-order
  (-> Json
      (Effect (List OrderEvent)
              [InvalidOrderForm EmptyOrder UnknownCafe UnknownSku]
              [Cafes.known Catalog.price Mailer.send])))
```

Read it aloud: *place order takes untrusted JSON and produces a list of order
events. It can fail because the form is invalid, the order is empty, or the
café or a SKU is unknown. It looks up cafés, prices SKUs, and sends mail.*

A domain expert can review that sentence, and a reviewer can trust it. The
checker rejects any body that fails in an undeclared way or touches an
undeclared capability. Requirements name individual operations, so
`[Catalog.price]` grants pricing, not the whole catalog.

Everything above is still documentation; nothing has been implemented yet. It
already compiles to Schema definitions, tagged error classes, and service
interfaces.

## 3 Integrity and consistency

### Smart constructors

When a constrained value comes from somewhere other than a decoded form, use a
smart constructor: a function that returns the value or a typed error.
`decode` runs a type's schema checks and fails with `SchemaError`, which you
translate into a domain error:

```lisp
(type Quantity (Brand (Int :min 1 :max 200)))
(error InvalidQuantity {:requested Int})

(: quantity (-> Int (Effect Quantity [InvalidQuantity])))
(define quantity [n]
  (catch (decode Quantity n)
    (SchemaError _) (fail (InvalidQuantity {:requested n}))))
```

Combining a brand and a refinement gives a type that can't be confused with a
plain Int. In the generated code, applying the brand directly, as in
`(Quantity 0)`, calls Effect's `Quantity.make`, which throws at run time when
the value is out of range. That is a defect, not a typed error. Forma accepts
`(Quantity 0)` at compile time, so use the smart constructor for values you
haven't checked.

### Where to enforce a rule

"An order has at least one line" can be enforced in two places:

- **In the type**: `(List OrderLineForm :min-length 1)`. An empty order then
  fails decoding with every other malformed form.
- **In the workflow**: as below, with a dedicated `EmptyOrder` error.

The order desk wants empty orders reported specifically, so this model checks
in the workflow. Both choices are visible in the source.

## 4 Workflows as pipelines

Each step of the sketch becomes one function, and each signature states what
the step does to the order.

### Parse at the boundary

The form arrives as JSON. Decoding checks the shape and every refinement:
SKU patterns, bag counts, the email format, and the delivery tag. It turns a
`SchemaError` into the domain's `InvalidOrderForm`:

```lisp
(: parse-form (-> Json (Effect OrderForm [InvalidOrderForm])))
(define parse-form [input]
  (catch (decode OrderForm input)
    (SchemaError _)
      (fail (InvalidOrderForm {:reason "the order form does not match its schema"}))))
```

Past this point, nothing in the workflow sees untyped data.

### Validate against the business

The schema can't know which cafés have accounts. Validation asks the `Cafes`
service, and it produces the next state:

```lisp
(: validate-order
  (-> OrderForm (Effect ValidatedOrder [EmptyOrder UnknownCafe] [Cafes.known])))
(define validate-order [form]
  (do! [:let [id (OrderId (get form :order-id))
              cafe (CafeId (get form :cafe))]
        _ (when (empty? (get form :lines)) (fail (EmptyOrder {:order-id id})))
        known (Cafes.known cafe)
        _ (unless known (fail (UnknownCafe {:cafe cafe})))]
    {:id id
     :cafe cafe
     :email (get form :email)
     :lines (get form :lines)
     :delivery (get form :delivery)}))
```

`do!` sequences effects. `:let` binds ordinary values along the way, and
`fail` stops the workflow with a declared error. The signature allows only the
two errors this step can raise and the one capability it uses.

### Keep the core pure

Shipping is a business rule with no I/O, so it is an ordinary function:

```lisp
(: shipping-cost (-> Delivery Int Cents))
(define shipping-cost [delivery bags]
  (match delivery
    (Pickup _) 0
    (Courier _) (if (>= bags 20) 0 (+ 900 (* 50 bags)))))

(: total-bags (-> (List OrderLineForm) Int))
(define total-bags [lines] (sum (map (fn [line] (get line :bags)) lines)))
```

A function without an `Effect` type can't reach a service, even by accident:

```text
mechanics/pure-service: Function sneaky cannot call Catalog.price: functions
and constants have no services in scope. Give its define an Effect return signature.
```

The domain rules can therefore be tested with plain values, and reviewers know
which code can do I/O.

### Price

Pricing a line can fail if the catalog doesn't know the SKU. Pricing an order
prices every line, adds shipping, and totals:

```lisp
(: price-line (-> OrderLineForm (Effect PricedLine [UnknownSku] [Catalog.price])))
(define price-line [line]
  (do! [unit (Catalog.price (get line :sku))]
    (match unit
      (Some cents)
        (succeed {:sku (get line :sku) :bags (get line :bags) :grind (get line :grind)
                  :line-total (* cents (get line :bags))})
      None (fail (UnknownSku {:sku (get line :sku)})))))

(: price-order (-> ValidatedOrder (Effect PricedOrder [UnknownSku] [Catalog.price])))
(define price-order [order]
  (do! [lines (for-each (get order :lines) (fn [line] (price-line line)))
        :let [shipping (shipping-cost (get order :delivery) (total-bags (get order :lines)))
              subtotal (sum (map (fn [line] (get line :line-total)) lines))]]
    {:id (get order :id)
     :cafe (get order :cafe)
     :email (get order :email)
     :lines lines
     :delivery (get order :delivery)
     :shipping shipping
     :total (+ subtotal shipping)}))
```

`for-each` runs an effect for each element and collects the results. If any
line fails, the whole step fails with that line's `UnknownSku`.

### Recover where the business says to

The order desk was clear: a failed acknowledgment email is unfortunate, but
it must not lose the order. Express that by recovering inside the step:

```lisp
(: acknowledge (-> PricedOrder (Effect Bool [] [Mailer.send])))
(define acknowledge [order]
  (or-else-succeed
    (do! [_ (Mailer.send (get order :email)
                         (str "Thanks! Order " (get order :id)
                              " totals " (get order :total) " cents."))]
      true)
    false))
```

The empty error set `[]` in the signature is the business rule, checked. If the
recovery is removed, the checker reports that `acknowledge` can fail with
`MailerDown`.

### Announce what happened

```lisp
(: events-for (-> PricedOrder Bool (List OrderEvent)))
(define events-for [order acknowledged]
  (let [placed (OrderEvent.OrderPlaced {:order order})
        billed (OrderEvent.InvoiceRequested
                 {:order-id (get order :id)
                  :cafe (get order :cafe)
                  :amount (get order :total)})]
    (concat [placed billed]
      (if acknowledged
        [(OrderEvent.AcknowledgmentSent
           {:order-id (get order :id) :email (get order :email)})]
        []))))
```

### Compose

The workflow is the sketch from section 1, step by step:

```lisp
(define place-order [input]
  (do! [form (parse-form input)
        validated (validate-order form)
        priced (price-order validated)
        acknowledged (acknowledge priced)]
    (events-for priced acknowledged)))
```

Each step's output type is the next step's input type. The workflow's errors
are the union of the steps' errors, and its requirements are the union of
theirs. Both must appear in `place-order`'s signature. If `Mailer.send` is
left out, the checker points at the composition:

```text
mechanics/undeclared-requirement: Operation place-order requires Mailer.send,
but its signature declares only [Cafes.known Catalog.price].
```

The generated TypeScript has the same contract:

```ts
export const placeOrder = (
  input: Schema.Json,
): Effect.Effect<
  ReadonlyArray<OrderEvent>,
  InvalidOrderForm | EmptyOrder | UnknownCafe | UnknownSku,
  Cafes | Catalog | Mailer
> =>
  Effect.gen(function* () {
    const form = yield* parseForm(input);
    const validated = yield* validateOrder(form);
    const priced = yield* priceOrder(validated);
    const acknowledged = yield* acknowledge(priced);
    return eventsFor(priced, acknowledged);
  });
```

## 5 Errors at the edge

Domain errors travel as values until something at the edge decides what they
mean, such as an HTTP status:

```lisp
(: respond (-> Json (Effect String [] [Cafes.known Catalog.price Mailer.send])))
(define respond [input]
  (catch
    (do! [events (place-order input)]
      (str "202 accepted, " (count events) " events"))
    (InvalidOrderForm e) (succeed (str "400 " (get e :reason)))
    (EmptyOrder _) (succeed "422 an order needs at least one line")
    (UnknownCafe e) (succeed (str "404 unknown cafe " (get e :cafe)))
    (UnknownSku e) (succeed (str "422 unknown sku " (get e :sku)))))
```

The empty error set says every failure has been handled. Leave out the
`UnknownSku` case and the checker says so:

```text
mechanics/undeclared-error: Operation respond can fail with UnknownSku, but its
signature declares no errors.
```

Handling an error that `place-order` can't raise is also rejected, so
handlers don't pile up for failures that no longer exist.

## 6 Serialization and persistence

### Data transfer objects

The JSON contract and the domain types are the same declarations. `OrderForm`
is the wire schema for the incoming form, and `OrderEvent` is the wire schema
for outgoing events:

```ts
export const OrderEvent = Schema.Union([
  Schema.Struct({ _tag: Schema.Literal("OrderPlaced"), order: PricedOrder }),
  Schema.Struct({ _tag: Schema.Literal("InvoiceRequested"),
    "order-id": OrderId, cafe: CafeId, amount: Cents }),
  Schema.Struct({ _tag: Schema.Literal("AcknowledgmentSent"),
    "order-id": OrderId, email: Email }),
]);
```

Field names keep their Forma spelling on the wire (`"order-id"`), and tagged
values carry a `_tag` discriminator. Use `(Tagged :tag kind ...)` to choose a
different field. If a public contract needs a different shape from the domain
type, declare a separate DTO type and a pure function to map between them, as
*Domain Modeling Made Functional* recommends. Forma has no implicit mapping.

### Implementations are layers

The workflow never says *how* cafés are looked up or SKUs priced. A **layer**
supplies a service's implementation. It can be written in Forma:

```lisp
(: wholesale-prices (Map String Cents))
(define wholesale-prices {"BEAN-001" 1800 "BEAN-002" 2100 "GEAR-010" 4500})

(layer CatalogFixed
  :provides Catalog
  (define price [sku] (succeed (get wholesale-prices sku))))
```

It can also be written in TypeScript against the generated service class,
which is how a database, an SMTP client, or a test double is provided:

```ts
Layer.succeed(Mailer, {
  send: (_to, _body) => Effect.fail(new MailerDown()),
});
```

The workflow's code doesn't change. Run with a mailer that always fails,
`place-order` still succeeds and emits `OrderPlaced` and `InvoiceRequested`,
and no `AcknowledgmentSent`. With a café that has no account, it fails with
`UnknownCafe` before the catalog is consulted.

## 7 Evolving the model

Larkspur starts shipping pallets to larger customers by freight. The domain
expert describes a new kind of delivery, and the model changes in one place:

```lisp
(type Delivery
  (Tagged
    (Pickup {:roastery String})
    (Courier {:street String :city String :postcode String})
    (Freight {:carrier String :pallets Int})))
```

The checker then lists the code the change affects:

```text
mechanics/non-exhaustive-match: match does not handle Freight.
```

It points at the `match` in `shipping-cost`. That is the right place: freight
shipping needs a pricing rule, and someone has to ask the domain expert for
it. Changes to requirements and errors work the same way. A step that starts
using a new service, or raising a new error, is reported in every signature
that would have to change, up to the workflow.

## 8 When the domain wants its own language

Types and workflows take a domain model a long way. Some domains go further
and have their own vocabulary: entities and relations, HTTP endpoints, email
rules, approval policies. Forma can make that vocabulary part of the
language. A [`form`](./writing-a-form.md) declares a new piece of syntax, the
type of each part, and the typed data it produces. Diagnostics are reported
at the author's text. The repository's preludes use forms to define
[`entity` and `query`](./language.md#domain-declarations),
[HTTP APIs](./effect/http-api.md), and [email rules](./email.md).
[Structure and Interpretation of Forma Programs](./structure-and-interpretation.md#_4-3-forms-programs-that-define-languages)
builds a small one from scratch.

## What the model can't express yet

Forma is pre-alpha. These limits affect domain modeling today.
[RFC 0019](https://github.com/bjacobso/forma/blob/main/docs/rfcs/0019-everyday-checker-gaps.md) proposes fixes for the first two.

- **Refinements are checked at decode time, not proven.** `(Bags 0)`,
  `(Quantity 0)`, and even `-5` declared as `Cents` compile. Use `decode` or a
  smart constructor for values you haven't checked. The RFC proposes checking
  literals at compile time; computed values would still be checked at run
  time.
- **`for-each` needs a literal `fn`.** `(for-each lines price-line)` is
  rejected, so `price-order` writes `(fn [line] (price-line line))`. `map`
  already accepts a named function.
- **Generic operations are not supported** in Effect programs. Every operation
  has concrete types.
- **There is no date or time type.** Model dates as `Int` day numbers and do
  calendar arithmetic, such as month lengths, in the host. See
  [Authoring your own program](./authoring.md#modelling-time).
- **Effect programs run as generated TypeScript.** Forma's own evaluator does
  not execute them. Run them with Effect, as the
  [Effect TypeScript conformance suite](https://github.com/bjacobso/forma/tree/main/conformance/effect-typescript)
  does.

See the [Effect reference](./effect/reference.md#what-is-not-covered-yet) for
the full list.
