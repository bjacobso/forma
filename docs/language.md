# Language

Forma is a typed Lisp for executable programs and domain languages. Types, schemas,
and form contracts use the same syntax. The reader keeps source identity and spans
for diagnostics, formatting, and structural editing.

## Values and expressions

The primitive types are `Unit`, `Bool`, `Int`, `Float`, `String`, `Keyword`, and
`Symbol`. Integers can be used where a `Float` is expected. Strings, keywords, and
quoted symbols are distinct values: `"ready"`, `:ready`, and `'ready` do not compare
equal. `nil` has type `Unit`.

`1` is Int; `1.0` and `1e0` are Float even when their value is integral.
`Number` and `Num` are legacy aliases for Float in the TypeScript engine.
`+`, `-`, `*`, `min`, `max`, and `abs` return Int when all operands are Int,
otherwise Float. `/` always returns Float; `mod` requires Int operands and a
nonzero divisor. `floor`, `ceil`, and `round` return Int (`round` sends ties toward
positive infinity). Assignment from Int to Float is permitted without retagging
the value. Equality compares numeric values, so `(= 2 2.0)` is true; numeric
literal patterns distinguish their kinds.

Int uses JavaScript's safe range, −9007199254740991 through 9007199254740991.
Out-of-range literals and arithmetic results fail instead of wrapping. Float
uses IEEE 754, including NaN, infinities, and signed zero; division by zero follows
IEEE rules. NaN does not equal itself. Rounding nonfinite or out-of-range values
fails. Values print as `2` and `2.0`; `str` uses the OCaml spelling `2.` for an
integral Float. Tagged host values retain their kinds; plain JSON erases them and
encodes nonfinite values as null. See the [numeric design decision](./design-decisions#distinct-int-and-float-values)
for engine and generated TypeScript boundaries.

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
(: distance (-> {:x Float :y Float} Float))
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

Ordinary type aliases and signatures can compute closed record shapes:

```lisp
(type Person {:name String :age Int})
(type Name (Pick Person [:name]))
(type PublicPerson (Omit Person [:age]))
(type Identified (Merge {:id String} PublicPerson))
```

`Pick` keeps the listed fields; `Omit` removes them. Their second argument
must be a literal vector of distinct keywords, and every listed field must
exist. Empty vectors are allowed. `Merge` combines records with disjoint
fields; overlapping names are errors even when their types agree. Aliases
and nested operations are supported, and retained field types may be
polymorphic. Both engines require known, closed outer record shapes: operations
on whole-record variables or open rows report an error. These are type
operations; they do not project or merge values or generate Effect schemas.
Open-row disjointness constraints are not implemented.
For computed record annotations, supply optional fields explicitly as `Some`
or `None`; implicit wrapping and filling currently require explicit record
type syntax.

## Unions and tagged values

`Union` accepts types or literal values and has no discriminator. `Tagged` declares
constructors. Capitalized constructor names distinguish them from lowercase
binding patterns.

```lisp
(type Shape (Tagged (Circle {:radius Float}) (Square {:side Float}) Point))
(: area (-> Shape Float))
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
Inline record payloads must be closed and must not declare the discriminator
field. A conflicting field or an open payload tail reports a located error.

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
| `String`, `Int`, `Float`, `Symbol`, `Keyword` | Parses a literal |
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
