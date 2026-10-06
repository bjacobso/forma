# Language

Forma is a typed Lisp for executable programs and domain languages. Types, schemas,
and form contracts use the same syntax. The reader keeps source identity and spans
for diagnostics, formatting, and structural editing.

## Values and expressions

The primitive types are `Unit`, `Bool`, `Int`, `Number`, `String`, `Keyword`, and
`Symbol`. Integers can be used where a `Number` is expected. Strings, keywords, and
quoted symbols are distinct values: `"ready"`, `:ready`, and `'ready` do not compare
equal. `nil` has type `Unit`.

Parentheses call a function or introduce a special form. Braces always contain
records or dictionaries. Square brackets contain lists; their elements share a
common type. Semicolons begin comments.

```lisp
(define greeting "Hello")
(define numbers [1 2 3])
(define person {:name "Ada" :age 36})
(+ person.age 1)
```

Dot access follows lexical bindings: `person.age` reads the `:age` field of
`person`. Service members such as `Clock.now` resolve through their service.
`get` accepts a computed key. Keyword keys and string keys retain their identity.

## Definitions and signatures

Use `define` for both values and functions. Parameters are patterns; signatures
are written separately with `:` and may precede or follow a definition in the
same module.

```lisp
(: increment (-> Int Int))
(define increment [value] (+ value 1))

(define distance [point]
  (+ point.x point.y))
(: distance (-> {:x Number :y Number} Number))
```

`fn` makes an anonymous function. `let` binds values in lexical scope. `if` requires
a `Bool` condition, and its branches must have a common type. `do` evaluates a
sequence and returns its final expression. Quote returns syntax without evaluating
it; quasiquote supports `~` and `~@` for substitution and splicing.

A keyword literal keeps its exact type: `:open` has type `:open`. Branches and
collections of different keywords infer their union. `Keyword` accepts any keyword,
including ones constructed at runtime.

## Types are schemas

`type` names a shape. A record type has the same appearance as its values. Fields
are required by default. `(Option T)` means an absent value, represented by `None`,
or a present value, represented by `(Some value)`.

```lisp
(type OrderId (Brand String))
(type Status (Union :pending :paid :shipped))
(type Order
  {:id OrderId :status Status :total-cents Int :coupon (Option String)})

(: example Order)
(define example
  {:id (OrderId "order:1") :status :pending :total-cents 1200})
```

In a record checked against an expected type, an omitted optional field becomes
`None`, and a plain supplied value becomes `Some`. An existing `Option` stays an
`Option`. Schema and artifact encodings omit absent optional fields.

`(Brand T)` takes its nominal name from the declaration. Two brands of the same
underlying type remain distinct. `(List T)` describes a homogeneous list.
`(Map K V)` describes a dictionary: keys may be strings, string brands, or a finite
union of keyword or string literals. Dictionary lookup returns `(Option V)`.

```lisp
(: scores (Map String Int))
(define scores {"Ada" 10 "Grace" 12})
(match (get scores "Ada")
  (Some score) score
  None         0)
```

An open record includes a row variable after `&`, as in `{:name String & row}`.
Generic aliases name their parameters: `(type (Box a) {:value a})`.

## Unions and tagged values

`Union` accepts types or literal values and has no discriminator. `Tagged` declares
constructors. Capitalized constructor names distinguish them from lowercase
binding patterns.

```lisp
(type Shape (Tagged (Circle {:radius Number}) (Square {:side Number}) Point))
(: area (-> Shape Number))
(define area [shape]
  (match shape
    (Circle {:radius radius}) (* 3.14159 radius radius)
    (Square {:side side})     (* side side)
    Point                    0))
```

Constructors belong to their type: `Shape.Circle` is always explicit. Bare
constructors resolve from the expected type when needed. The discriminator is
`:_tag` by default; `(Tagged :tag kind ...)` selects another field. Record payloads
merge into the tagged record; scalar payloads occupy `:value`.

`class` and `error` declare named record types with the same field syntax. Errors
have a discriminator derived from their name and may appear in Effect error sets.

```lisp
(class Customer {:name String})
(error OrderNotFound {:id OrderId})
(error Timeout)
```

## Patterns

`fn`, `define`, `let`, `match`, and `catch` share pattern conventions. Lowercase
names bind, `_` ignores a value, literals compare values, and capitalized names
match constructors. Records and vectors destructure their members. `&` captures
remaining members or elements, and `:as` retains the whole matched value.

```lisp
(define first-name [{:name name}] name)
(let [[first & rest] [1 2 3]] first)
(match (Some 7) (Some value) value None 0)
```

## Effects

An Effect type is `(Effect Success [Errors] [Requirements])`; omitted sets are
empty. Definitions with Effect signatures use ordinary `define`. A zero-argument
Effect is a value.

```lisp
(service Clock (: now (Effect Int)))
(: next (Effect Int [] [Clock.now]))
(define next
  (do! [now Clock.now :let [later (+ now 1)]] later))
```

`do!` runs effects; `:let` binds pure values within the sequence. A plain tail value
is lifted into the enclosing Effect. Services use `:` members and layers implement
members with `define`. See the [Effect reference](/effect/reference) for resources,
concurrency, recovery, and generated TypeScript.

## Typed forms

A form is a function from syntax to a declared IR type. Its pattern specifies
positional arguments, trailing keyword options, and repeated child forms. Its
hole types specify how those arguments parse and check.

```lisp
(type GreetingIR {:kind "Greeting" :name Symbol :message String :doc (Option String)})
(form (greeting name message {:keys [doc]})
  "Declare a greeting."
  :types {:name (Declares Greeting) :message String :doc (Option String)}
  :ir GreetingIR
  {:kind "Greeting" :name name :message message :doc doc})

(greeting welcome "Hello" :doc "Shown on arrival")
```

| Hole type | Meaning |
| --- | --- |
| `(Declares T)` | Introduces a declaration name of type `T` |
| `(Refers T)` | Resolves a name to a declaration of type `T` |
| `String`, `Int`, `Symbol`, `Keyword` | Parses a literal |
| `Type` | Parses a type expression |
| `(Expr T)` | Checks an expression at `T` |
| `(Record T)` | Supplies record members with type `T` |
| `(List child)` | Parses child forms and supplies their IR values |
| `(Option H)` | Allows an absent hole |

A pattern ending in `child ...` accepts zero or more children. A `:scope` function
provides bindings while checking a chosen hole. `:check` returns diagnostics;
`:type` supplies a result type or computes one from the holes. Projection bodies
are ordinary Forma expressions. The declared IR type checks their output and
provides the schema used at the artifact boundary.

## Domain declarations

Entities use short field names and derive attribute namespaces. References use
`(Id Entity)`; an optional entity attribute uses `(Option T)`.

```lisp
(entity Department {:name String})
(entity Employee
  {:name String :department (Id Department) :active (Option Bool)})
(seed Employee "employee:ada"
  {:name "Ada" :department "department:engineering"})
(query people :from Employee :where (= name "Ada") :select [name])
```

Inside a query, fields from the `:from` entity enter the predicate scope. Predicates
must have type `Bool`. Seed and link records check their field names, values, and
required fields against the referenced entity or relation.

## Structural tools

Forma's formatter and editor share the reader's lossless syntax tree. Diagnostics
refer to author spans, including expressions produced through macros.
