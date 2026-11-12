# Forma cheat sheet

Forma is a pre-alpha typed Lisp. Source files end in `.lisp`. Vocabulary belongs
in preludes; TypeScript is the engine. Start here, then ask your application for
its vocabulary with `lang.describe()` or `forma describe entry.lisp`.

## Syntax and literals

Parentheses call functions or introduce forms. Vectors hold values; braces hold
key/value pairs. Whitespace and commas separate items. Semicolons start comments.
Strings use double quotes; keywords begin with `:`. Quote preserves syntax as data.

```lisp
; A complete program; the final expression is its result.
(define message "hello")
(define values [1 2 3])
message
true
false
nil
:ready
'name
(+ 20 22)
1.0
```

`Int` is a safe integer; `Float` is distinct even for `1.0`. Arithmetic does not
silently coerce between them. Empty vectors are lists whose element type is
inferred from use. Nil is not an absent Option value.

## Types, annotations, and functions

Use `(: name Type)` before a definition. Function types list arguments followed
by the result. `define` creates a binding; a parameter vector creates a function.
`fn` makes an anonymous function; `let` creates local bindings. `if` requires a
Bool condition and compatible branch results.

Write `?` or `?name` for an unfinished expression: checking reports its expected
type and up to ten fitting bindings; programs with holes cannot run.

```lisp
(: greet (-> String String))
(define greet [name] (str "Hello, " name))
(define twice (fn [n] (+ n n)))
(let [name "Ada" amount (twice 21)]
  (if (> amount 0) (greet name) "Nobody"))
```

Primitive types include `Int`, `Float`, `String`, `Bool`, `Symbol`, `Keyword`,
`Nil`, and `Unit`; containers include `(List a)`, `(Map k v)`, `(Option a)` and
`(Result a e)`. Lowercase variables express polymorphism. A `type` declaration
names a contract; `Brand` gives a value a distinct nominal identity. `Number`
and `Num` are retired spellings.

```lisp
(type UserId (Brand String))
(: identity (-> a a))
(define identity [value] value)
(identity (UserId "user-1"))
```

## Records

Keyword fields and dot access describe records. An annotation can constrain the
record shape; extra fields and open rows follow the checked function's contract.

```lisp
(type Person {:name String :age Int})
(: label (-> Person String))
(define label [person] (str person.name ": " person.age))
(label {:name "Ada" :age 36})
```

## Tagged choices, match, and Option

Tagged constructors belong to their type. `match` alternates patterns and
expressions and must cover every possible case. Payload patterns bind names.

```lisp
(type Status (Tagged (Ready {:message String}) Empty))
(: status-label (-> Status String))
(define status-label [status]
  (match status
    (Status.Ready payload) payload.message
    Status.Empty "Waiting"))
(status-label (Status.Ready {:message "Ready"}))
```

Use `Some` and `None` for presence and absence. A field of type `(Option String)`
must contain an Option, including when absent. Pattern matching unwraps it.

```lisp
(: display (-> (Option String) String))
(define display [value]
  (match value (Some text) text None "Unknown"))
[(display (Some "Ada")) (display None)]
```

## Modules and imports

Each file is isolated. Export public names explicitly. Named imports select
exports; namespace imports use `/`. Relative paths include `.lisp`. Export a
public signature's types along with its functions. Loading a source file alone
does not publish its bindings. The following two fences are checked together.

```lisp file=helpers.lisp
(export double)
(: double (-> Int Int))
(define double [value] (* value 2))
```

```lisp file=main.lisp
(import "./helpers.lisp" [double])
(import "forma:kernel" [and])
(and true (= (double 21) 42))
```

Bundled libraries use `forma:kernel`, `forma:test`, `forma:clojure`, and
`forma:routes`, with no copying or dependency setup.
A barrel can reexport names with `export-from`. An application's
`createLanguage({ modules: [{ id, source }] })` automatically imports those
modules' exports into programs. Legacy `preludes` share a declaration scope.
Module imports preserve private helper scope and nominal identities. See
[File modules](./modules.md) for packages and project preludes.

## Forms

A form is a typed syntax pattern with holes, an IR contract, and a pure
projection. Docstrings and `:examples` describe its use. `Declares` holes
introduce named domain declarations; optional slots use Option types.

```lisp
(type NoticeIR {:text String})
(form (notice text)
  "Describe a notice."
  :types {:text String}
  :ir NoticeIR
  :examples [[(notice "Hello")]]
  {:text text})
(notice "Hello")
```

`describe` lists forms first, then functions, then types, including slot types,
optionality, result and IR types, documentation, and checked examples. The
[prelude catalog](./preludes/index.md) identifies each shipped vocabulary and
its maturity. Domain forms elaborate to data; they do not inherently run effects.

## Effects

Effect programs are checked and generated as TypeScript for the Effect runtime.
`Effect` types track success, error, and required service sets. `succeed` creates
a successful effect; `do!` sequences effects and binds their successful values.

```lisp
(: main (Effect Int [] []))
(define main
  (do! [value (succeed 41)]
    (succeed (+ value 1))))
```

Use explicit signatures, declared errors, services, and layers for generated
programs. The pure evaluator does not execute Effect initializers from modules.
See [Effect reference](./effect/reference.md) for the supported operations and
current limits. General direct-style effects remain planned.

## Builtins

This table is generated from the checker's builtin contracts. It lists names
with both a default runtime implementation and an HM scheme. The Effect target
supports a subset. A signature is a checker contract; see the language guide
for individual runtime operations. Variables such as `a0` are generic types.
Numeric rows retain a `Numeric` constraint until inputs determine Int or Float.
For example, `(reduce + 0 [1 2 3])` checks as Int. In call position
`+ - * / min max` take any number of arguments; `/` always returns Float. `Unknown` marks a permissive contract, not a guarantee about values.

<!-- builtin-contracts:start -->
| Name | Signature |
| --- | --- |
| `-` | `(Numeric a0) => forall a0. a0 -> a0 -> a0` |
| `!=` | `forall a0. a0 -> a0 -> Bool` |
| `*` | `(Numeric a0) => forall a0. a0 -> a0 -> a0` |
| `/` | `(Numeric a0) => forall a0. a0 -> a0 -> Float` |
| `+` | `(Numeric a0) => forall a0. a0 -> a0 -> a0` |
| `<` | `(Numeric a0) => forall a0. a0 -> a0 -> Bool` |
| `<=` | `(Numeric a0) => forall a0. a0 -> a0 -> Bool` |
| `=` | `forall a0. a0 -> a0 -> Bool` |
| `>` | `(Numeric a0) => forall a0. a0 -> a0 -> Bool` |
| `>=` | `(Numeric a0) => forall a0. a0 -> a0 -> Bool` |
| `abs` | `(Numeric a0) => forall a0. a0 -> a0` |
| `ceil` | `(Numeric a0) => forall a0. a0 -> Int` |
| `concat` | `(-> (List a) (List a) (List a))` |
| `conj` | `(-> (List a) a (List a))` |
| `count` | `forall a0. List<a0> -> Int` |
| `ends-with?` | `String -> String -> Bool` |
| `Err` | `forall a0 a1. a1 -> Result<a0, a1>` |
| `fail` | `String -> Never` |
| `filter` | `forall a0. (a0 -> Bool) -> List<a0> -> List<a0>` |
| `first` | `forall a0. List<a0> -> a0` |
| `floor` | `(Numeric a0) => forall a0. a0 -> Int` |
| `format` | `...Unknown -> String` |
| `id` | `forall a0. a0 -> String` |
| `keyword` | `Unknown -rest Unknown-> Keyword` |
| `keyword?` | `forall a0. a0 -> Bool` |
| `keyword/name` | `Unknown -> String` |
| `map` | `forall a0 a1. (a0 -> a1) -> List<a0> -> List<a1>` |
| `max` | `(Numeric a0) => forall a0. a0 -> a0 -> a0` |
| `meta` | `Unknown -> Unknown -> Unknown -> Unknown` |
| `meta/get` | `Unknown -> Unknown -> Unknown` |
| `min` | `(Numeric a0) => forall a0. a0 -> a0 -> a0` |
| `mod` | `Int -> Int -> Int` |
| `nth` | `forall a0. List<a0> -> Int -> a0` |
| `Ok` | `forall a0 a1. a0 -> Result<a0, a1>` |
| `Option.Some` | `forall a0. a0 -> Option<a0>` |
| `quot` | `(-> Int Int Int)` |
| `reduce` | `(-> (-> b a b) b (List a) b)` |
| `rest` | `forall a0. List<a0> -> List<a0>` |
| `Result.Err` | `forall a0 a1. a1 -> Result<a0, a1>` |
| `Result.Ok` | `forall a0 a1. a0 -> Result<a0, a1>` |
| `reverse` | `(-> (List a) (List a))` |
| `round` | `(Numeric a0) => forall a0. a0 -> Int` |
| `Some` | `forall a0. a0 -> Option<a0>` |
| `split` | `String -> String -> List<String>` |
| `sqrt` | `(-> Float Float)` |
| `starts-with?` | `String -> String -> Bool` |
| `str` | `...Unknown -> String` |
| `sym` | `String -> Symbol` |
| `symbol?` | `forall a0. a0 -> Bool` |
| `trim` | `String -> String` |
| `type/base` | `Unknown -> Unknown` |
<!-- builtin-contracts:end -->

## Ten common diagnostics and fixes

These are common authoring failures, not a frequency ranking. Run
`forma explain CODE` for the full catalog entry. Spans carry line and column;
messages contain the problem itself.

| Code | Fix |
| --- | --- |
| `reader/unexpected-eof` | Close the missing list, vector, map, or string delimiter. |
| `surface/invalid-form` | Check the form's shape and replace retired spellings as suggested. |
| `typecheck/unbound-symbol` | Define or import the name; check spelling and lexical scope. |
| `typecheck/unknown-type` | Declare or import the type and export it from its owning module. |
| `typecheck/type-mismatch` | Compare expected and actual types; use the right numeric kind or constructor. |
| `typecheck/arity` | Supply the function's required argument count. |
| `typecheck/pattern` | Add missing match cases and use patterns valid for the scrutinee. |
| `module/not-found` | Check the relative path, extension, and available source bundle. |
| `module/private-export` | Export the requested name from its defining file. |
| `module/private-type` | Export each type mentioned by a public signature. |

`pnpm check:cheatsheet` checks every Lisp fence, the generated builtin table,
the diagnostic codes, and the 2,500-word budget. See [Embedding](./embedding.md)
for typed host capabilities and [Authoring](./authoring.md) for CLI setup.
