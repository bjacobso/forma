# RFC 0001: One language, one syntax

| | |
| --- | --- |
| Status | Implemented |
| Created | 2026-10-05 |
| Scope | Reader, core language, Effect surface, descriptor/meta layer, domain preludes, tooling |
| Compatibility | Breaking. The project is pre-alpha with no published packages, so canonical authoring syntax replaces the previous grammar directly; an automated migration handles older source. |

## Summary

Forma has grown four type languages, about fourteen ways to write "a name with a type",
three ways to write an option, and five separate places that together define a single
domain form. This RFC proposes one type language, one record syntax, one option syntax,
noun-headed declarations, and a meta layer of three forms (`type`, `form`, `macro`). It
quotes the current syntax to show each problem, specifies the replacement, and lays out
a phased implementation that keeps both engines and every conformance suite green
throughout.

The proposal in one screen:

```lisp
(type OrderId (Brand String))
(type Status  (Union :pending :paid :shipped))
(type Order   {:id OrderId :status Status :total-cents Int :coupon (Option String)})

(error OrderNotFound {:id OrderId})

(service Orders
  (: find (-> OrderId (Effect Order [OrderNotFound])))
  (: save (-> Order (Effect Unit))))

(: pay (-> OrderId (Effect Order [OrderNotFound PaymentDeclined] [Orders Payments.charge])))
(define pay [id]
  (do! [order (Orders.find id)]
    (match order.status
      :pending (do! [_ (Payments.charge order.total-cents)] order)
      _        order)))

(entity Employee {:name String :department (Id Department) :active (Option Bool)})

(form (entity name fields {:keys [doc]})
  "A named record of attributes."
  :types {:name (Declares SchemaDecl) :fields (Record Type) :doc (Option String)}
  :ir    EntityIR
  {:kind "Entity" :name name :doc doc :fields (entity-fields name fields)})
```

## Contents

1. [Motivation](#_1-motivation)
2. [Design principles](#_2-design-principles)
3. [Problems in the current syntax](#_3-problems-in-the-current-syntax)
4. [Proposed syntax](#_4-proposed-syntax)
5. [Before and after: complete programs](#_5-before-and-after-complete-programs)
6. [Old-to-new reference table](#_6-old-to-new-reference-table)
7. [Alternatives considered](#_7-alternatives-considered)
8. [Implementation plan](#_8-implementation-plan)
9. [Risks](#_9-risks)
10. [Open questions](#_10-open-questions)

## 1. Motivation

Forma's bet is that a Lisp with typed macros and elaborator reflection can host many
domain languages while keeping them reviewable. That bet depends on the host language
being small and regular. Today it isn't:

- **Four type languages.** HM core types (`Num`, `(List a)`, `(Maybe a)`), Effect schemas
  (`Int`, `(Array T)`, `Struct`, `Optional`), ontology field specs
  (`(:field [ns/name T {:required true}])`), and payload/protocol contracts
  (`(:name (:type string) (:required true))`). Each has its own type names, optionality
  default, enum spelling, and reference syntax.
- **Many binder shapes.** A name paired with a type or value is written in at least
  fourteen different shapes (listed in [§3.2](#_3-2-fourteen-ways-to-write-a-name-with-a-type)).
- **Three option syntaxes** (`(:k v)`, `{:k v}`, trailing `:k v`), sometimes in one file.
- **Five places per domain form.** A `define-form` descriptor, a `define-payload-contract`,
  a construct `meta-fn`, a hand-written `define-elaboration` copy for OCaml, and a protocol
  carrier `define-form`, plus four hand-maintained registration lists. That is about 60
  lines of meta code per author-facing keyword; the `Workspace` kind is synchronised
  by hand in nine places.
- **Engine disagreements** that a syntax pass must not paper over: the evaluator and the
  typechecker give `match`, keywords, map keys and `get` different meanings.

Each authoring surface was reasonable when it was added. Together they make every new
DSL author learn several dialects, and they make the generated contracts (the product)
harder to keep consistent.

## 2. Design principles

1. **One type language.** Types are schemas. The same expression drives HM inference,
   schema and codec generation, entity fields, IR payload contracts, and form-syntax
   descriptions.
2. **Declarations mirror construction.** The type of `{:id "x"}` is written `{:id String}`.
   An error declared with `{:id OrderId}` is built with `(OrderNotFound {:id id})`.
3. **One way to attach a type to a name.** `(: name Type)` for bindings and
   `{:key Type}` for record members. Parameters are always bare names.
4. **One way to write options.** Trailing `:key value` pairs. Repeated children are
   plain child forms; no `(:clause (clause ...))` wrappers.
5. **Top-level heads are nouns.** Top-level position already means "declaration".
   `define` binds values; every other head names the kind of thing declared.
6. **A form is a typed function from its syntax to its IR.** Syntax shape, bindings,
   validation, result type, payload contract, completion, and formatting derive from
   one definition.
7. **Keywords are literals.** `:paid` is a value whose type is the literal `:paid`.
8. **Fix semantics before syntax.** Where the engines disagree, the disagreement is a
   bug to fix first, not a choice to encode.

## 3. Problems in the current syntax

Every example in this section is quoted from the repository at commit `5709d16`.

### 3.1 Four type languages

The same idea, "an order has an id, a status and an optional coupon", is written
differently depending on which pipeline will read it.

**Effect schema** (`conformance/effect-typescript/cases/crud-users/program.lisp:9-15`):

```lisp
(define-schema User
  (Struct
    (field id UserId)
    (field name String)
    (field email String)
    (field role Role)
    (field nickname (Optional String))))
```

**Ontology entity** (`examples/todo-app/README.md:18-20`). Fields are optional by default
and use a different type name for booleans:

```lisp
(define-entity Todo
  (:field [todo/title String {:required true}])
  (:field [todo/completed Boolean {:default false}]))
```

**HTTP schema** (`examples/compiler-debug/http-api.md:15-23`). A third grammar for the
same head, distinguished from the Effect one by counting items
(`packages/ts/src/mechanics/artifact.ts:78-84`):

```lisp
(define-schema DebugBlobUploadResponse
  (:kind struct)
  (:fields
    (field hash DebugBlobHash)
    (field size Int)
    (field filename (Optional String)))
  (:identifier "DebugBlobUploadResponse"))
```

**Protocol / IR record** (`preludes/ontology-ir.lisp:632-644`). A fourth grammar, with
lowercase type names and `(:required true)` clauses:

```lisp
(define-form ontology-ir-workspace
  (:phase meta)
  (:extensions
    (:protocol/object
      (:name WorkspaceIR)
      (:fields
        (:kind (:kind literal) (:values [Workspace]) (:required true))
        (:name (:type string) (:required true))
        (:title (:type string))
        (:views (:kind array) (:item string))))))
```

**Payload contract** (`preludes/ontology.lisp:123-139`). A fifth description of the same
payloads, consumed only by OCaml; TypeScript keeps a separate hard-coded table
(`packages/ts/src/artifact/artifact.ts:97-160`):

```lisp
(define-payload-contract RecordPayload
  (:contract [KindPayload ObjectFieldsPayload])
  (:required-fields [id entity])
  (:literal-fields [[kind "Record"]])
  (:string-fields [id entity]))
```

**Core ADTs** use yet another syntax, and tagged unions in schemas use a different one
again (`pure-domain-logic/program.lisp:7-11`):

```lisp
(define-type (Maybe a) (Some a) (None))          ; core

(define-schema Discount                           ; Effect
  (TaggedUnion type
    [percent (Struct (field rate Int))]
    [fixed (Struct (field cents Int))]
    [none (Struct)]))
```

The vocabularies drift accordingly:

| Concept | Spellings in use |
| --- | --- |
| Boolean | `Bool`, `Boolean` (examples use `Boolean` 55 times, `Bool` once), `boolean` |
| Number | `Num`, `Number`, `Int`, `number` |
| Sequence | `(List a)`, `(Array T)`, `Vector`, `(:kind array)` |
| Map | `(Map K V)` in core, `(Map V)` in Effect |
| Absent value | `(Maybe a)`, `(Option T)`, `(Optional T)`, `{:required true}`, `{:optional true}`, `(:required true)` |
| Enum | `(Enum a b)`, `(Literal a b)`, `(:enum ["a" "b"])`, `(validate validate-one-of ...)`, `(:kind literal) (:values [...])` |
| Reference | `(Ref X)` = entity id, schema reference, Effect mutable cell, elaboration ref, protocol union member |

### 3.2 Fourteen ways to write a name with a type

| Where | Shape | Example |
| --- | --- | --- |
| `let`, `do!` | `[name value ...]` | `(let [x 1] ...)` |
| Service method params | `[name Type ...]` | `(find [id UserId] ...)` |
| Operation params | `[name]` + separate `(: ...)` | `(define-operation get-user [id] ...)` |
| Layer method params | `[name]`, types by position from the service | `(find [id] ...)` |
| Core row type | `[(name T) ...]` | `[(name String) (age Num) ...]` |
| Legacy row type | `{:name T :* r}` | |
| Effect struct | `(field name T)` | `(field id UserId)` |
| Undocumented struct | `[name T]`, `(name T)` | accepted by `artifact.ts:2269-2290` |
| Error/class fields | `(:fields (field name T) ...)` | `(define-error UserNotFound (:fields (field id UserId)))` |
| Tagged-union variant | `[tag Schema]` | `[percent (Struct ...)]` |
| Entity field | `(:field [ns/name T {...}])` | `(:field [employee/name String {:required true}])` |
| Seed record value | `(:field [ns/name "value"])` (value stored in the type slot) | `(:field [candidate/name "Sam Patel"])` |
| Task input | `(:input name T (:required true))` | |
| Document field | `(field Type path ...)`, reversed order | `(field text :i9.last_name (:label "Last Name"))` |

Two consequences. A service method's type and an operation's type are the same type
written two ways:

```lisp
(define-service UserRepo
  (:methods
    (find [id UserId] (Effect (Option User) [] []))))   ; crud-users:29

(: get-user (-> UserId (Effect User [UserNotFound] [UserRepo.find])))  ; crud-users:65
```

And `field` names six different things (Effect member, entity child form, document
field, elaboration output clause, protocol key, view sort key). Because child forms are
resolved through the global descriptor table (`packages/ts/src/descriptor/normalize.ts:290-370`),
`(:field (field employee/name String))` inside an entity would parse as a document field
with type and path swapped.

### 3.3 Three option syntaxes and wrapper stutter

```lisp
(:field [employee/name String {:required true}])        ; map
(slot field value (:many true) (:required true))         ; clause
(all {:a e1 :b e2} :concurrency :unbounded)             ; trailing pairs
```

Repeated children need a keyword wrapper around a list with the same head
(`examples/staffing/processes.md:16-29`):

```lisp
(:node
  (node i9-section-1
    (:action collect-form)
    (:input [section-ids "employee-information"])
    (:input [assignee-type "entity"])))
```

The same appears as `(:edge (edge ...))`, `(:trigger (trigger ...))`, `(:page (page ...))`,
`(:field (field ...))`, `(:option (option ...))`, `(:direct (direct ...))`. Descriptors
stutter the same way: `(bind bind-declaration-name ...)`, `(validate validate-one-of ...)`.
`ui.lisp` even repeats a section to hold two options (`preludes/ui.lisp:35-46`):

```lisp
(define-form columns
  (:phase meta)
  (:extensions
    (:view/component
      (:allows-bind false)
      (:compile (:expr-props [visible]))
      (:children any)
      (:compile (:required-children true))))
  (:slots (slot gap value (:type Number))))
```

### 3.4 The `define-` prefix and self-reference

Every top-level head starts with `define-`, which carries no information at top level
and produces `define-form define-entity` (`preludes/ontology.lisp:357`). Meanwhile `fn`,
`let`, `instance`, `match` and `do!` are unprefixed, and `meta-fn` is a definition form
without the prefix. The current head inventory:

```text
define  define-type  define-typeclass  define-macro  define-schema  define-error
define-class  define-service  define-operation  define-layer  define-entity
define-meta-entity  define-relation  define-record  define-link  define-query
define-action  define-mutation  define-process  define-task  define-document
define-view  define-view-component  define-workspace  define-api-group
define-system-attribute  define-form  define-elaboration  define-elaboration-primitive
define-payload-contract  define-protocol  meta-fn  instance
```

### 3.5 Effect surface specifics

**Mandatory empty slots.** `(Effect A [E] [R])` must have exactly four items
(`artifact.ts:1723-1745`); service methods must leave R empty, so every method pays
`[] []`. There are 65 occurrences across the Effect conformance programs:

```lisp
(define-service UserRepo
  (:methods
    (find [id UserId] (Effect (Option User) [] []))
    (find-by-email [email String] (Effect (Option User) [] []))
    (save [user User] (Effect Unit [] []))
    (remove [id UserId] (Effect Bool [] []))
    (all [] (Effect (Array User) [] []))))
```

**Two definition heads for one idea.** `define` takes `(fn ...)` and one body form;
`define-operation` takes params directly and several body forms. The `(: ...)` signature
already says whether the result is an `Effect`.

**Services written twice.** Layer methods restate every method name with types removed
(`crud-users:97-115`), and parameter names need not match the service's.

**Pure values in effect blocks** go through `succeed` because `do!` only binds effects
(`pure-domain-logic/program.lisp:77-81`):

```lisp
(do! [nonempty (succeed (filter (fn [item] (> (get item :quantity) 0)) items))
      _ (when (empty? nonempty) (fail (EmptyCart {:customer (get customer :id)})))
      gross (succeed (subtotal nonempty))
      net (succeed (apply-discount (discount-for customer) gross))]
  ...)
```

**Field access** is the largest verbosity cost relative to the generated TypeScript
(`concurrent-workflow/program.lisp:43`; `pure-domain-logic` is the one program where Forma
is longer than its output):

```lisp
:score (* 10 (get (get parts :activity) :events))
```

**Enums and tags change spelling between declaration, value and pattern**
(`pure-domain-logic/program.lisp:5, 30-32, 55-58`):

```lisp
(define-schema Tier (Enum free pro enterprise))      ; symbols
{"free" {:type "none"} "pro" {:type "percent" :rate 10}}  ; strings
(match tier "free" "Free" "pro" "Pro" _ "Enterprise")     ; strings (bare symbols also work)
```

**Optional vs Option.** `(Optional String)` in a signature generates `string | void`;
`(Option String)` in a schema field fails with an unrelated metadata error. Optional
fields are written as plain values but read back as `(Option T)`.

**`Ref` means a schema reference inside `define-schema` and an Effect `Ref` in
signatures** (`artifact.ts:1592-1606`), so `(field counter (Ref Int))` fails with
"Unknown type Int".

**Brands name themselves twice:** `(define-schema UserId (Brand UserId String))`.

**Zero-field errors need ritual:** `(define-error Timeout (:fields))`, built with
`(Timeout {})`.

**Patterns.** `catch` accepts `(_ e)` as a catch-all that binds `e`; in `match`, `(_ e)`
is a wildcard that silently drops the binding, and the failure surfaces later as
"Unknown name e". Option tags are lowercase (`some`, `none`) while core constructors
are capitalised (`Some`, `None`).

### 3.6 The meta layer

Defining the `entity` form today takes five artefacts. The descriptor
(`preludes/ontology.lisp:357-387`):

```lisp
(define-form define-entity
  (:phase domain)
  (:doc "Canonical entity/schema declaration.")
  (:identifiers
    (identifier name Symbol (:declaration true)))
  (:slots
    (slot doc value)
    (slot role value)
    (slot id-pattern value)
    (slot field value
      (:many true)
      (:required true)
      (:child-form field)
      (:child-identifier name Value)
      (:child-slot type expr (:positional true))
      (:child-slot required value)
      (:child-slot indexed value)))
  (:bindings
    (bind bind-declaration-name (:identifier name) (:type SchemaDecl)))
  (:bindings-fn entity/bindings)
  (:extensions
    (:artifact
      (:payload (:contract EntityPayload))))
  (:construct-fn entity/construct)
  (:construct
    [kind "Entity"]
    [name (or declaration-name "anonymous-entity")]
    [fields (entity-fields field)]
    [loc loc])
  (:declaration-type (row))
  (:result-type (constant SchemaDecl)))
```

A construct hook (`preludes/ontology-compiler.lisp:430-467`, 38 lines), and a structural
copy of the same hook so OCaml need not interpret Lisp (`ontology-compiler.lisp:469-491`):

```lisp
; Plan A fast-path companion for entity/construct. This descriptor mirrors the
; meta-fn above so OCaml can execute the structural projection without
; interpreting the Lisp body.
(define-elaboration entity-elaboration
  (:hook entity/construct)
  (:form define-entity)
  (:kind "Entity")
  (:result-type "SchemaDecl")
  (:name name (:identifier name) (:default "anonymous-entity"))
  (:field name (:identifier name))
  (:field doc (:slot-string doc))
  ...
  (:field loc (:loc)))
```

Plus a payload contract, a protocol object, and entries in the module `:objects` list,
the `CanonicalIR` union, `CompiledDeclarations`, and the catalog
(`preludes/ontology-ir.lisp:646-910`).

Measured over the preludes:

- 348 `define-form`s, of which 226 (65%) declare neither identifiers nor slots. They are metadata
  carriers for `:extensions`.
- A typical ontology form costs ~22 descriptor lines, a 4-line contract, a 20–25 line
  hook or elaboration, ~12 lines of IR protocol, and four list entries.
- Boilerplate in `ontology.lisp` (48 forms): `(:phase domain)` 48/48,
  `(:result-type (constant ...))` 41, `[loc loc]` 32,
  `(identifier name Symbol (:declaration true))` 26, `(bind bind-declaration-name ...)` 24.
- The layers drift: static `:construct` blocks disagree with the real constructors for
  trigger, relation and constraint; three elaborations read a `doc` slot their form
  never declares; `compiler.lisp:43-60` describes `define-form` with a vector syntax the
  parsers do not accept, and defines `meta-fn descriptor-construct` twice (`:218`, `:230`).
- Fourteen `view/layout-alias` forms (`preludes/viewspec.lisp:110-217`) spend six lines
  each to say "this name is an alias for that component".

### 3.7 Stringly-typed references in domain DSLs

References that the elaborator could resolve and check are strings
(`examples/todo-app/README.md`):

```lisp
(create! "Todo" :todo/title title :todo/completed false)       ; :56  entity as string
(retract! (id todo) ":todo/title")                             ; :86  attribute as string
(action-button {:action-ref "add-todo" ...})                   ; :112 action as string
(table {:columns [{:key "?title" :label "Task"}]})             ; :117 datalog column as string
(:where (= (get it :todo/completed) false))                    ; :42  attribute as keyword
(:select [todo/title todo/completed])                          ; :32  attribute as symbol
(:state newTitle "" (:type string))                            ; :102 camelCase, lowercase type
```

One attribute is spelled five ways: `todo/title`, `:todo/title`, `":todo/title"`,
`"?title"`, and inside locale files `":bgc.full_name"`.

### 3.8 Engine and pass disagreements

These are correctness bugs independent of syntax. They were found by reading source and
need reproduction fixtures.

| Issue | Where |
| --- | --- |
| The evaluator has no ADT constructors; `(Some x)` / `None` in a pattern bind as variables | `evaluator/match.ts:55-130` vs `type/lower-control.ts:63-100` |
| `define-type` compiles to `NIL` in the VM and is ignored by the evaluator | `vm/compile-core.ts:279-282` |
| `unless` exists only in lowering; `quote` only in the reader | `type/lower-core.ts:183`; `reader/to-sexpr.ts:304` |
| `(get m v)` is a literal label `v` to the typechecker and a variable lookup at runtime | `type/lower-control.ts:108` vs `evaluator/eval-core.ts` |
| `{:a 1}` has label `":a"`, `{"a" 1}` has `"a"`; symbol keys differ by engine | `type/lower-core.ts:139-146`; `eval-core.ts:180-188` |
| Keywords: a `Sym` typed `String` (value includes the colon) in TS; a `Keyword` node and `TKeyword` in OCaml | `eval-core.ts:112`; `ocaml/lib/reader.ml:161` |
| `{a b}` reads as a Set, which every later pass rejects | `reader/green-tree-builder.ts:301-341` |
| TS silently ignores unknown slots and option-map keys; OCaml reports them | `descriptor/normalize.ts:132`, `:277-283` |
| Unknown schema metadata keys (`:min`) are dropped silently | `mechanics/effect-schema.ts:128-131` |
| `define-class` diagnostics say "define-error expects..." | `mechanics/artifact.ts:335` |

## 4. Proposed syntax

### 4.1 Reader

The data syntax is unchanged except where noted.

| Syntax | Meaning |
| --- | --- |
| `( ... )` `[ ... ]` `{ k v ... }` | list, vector, map |
| `:name`, `:ns/name` | keyword: a distinct token in both engines, evaluating to itself |
| `name`, `ns/name` | symbol; `/` is the only namespace separator |
| `a.b.c` | one symbol token; resolved as member access during lowering ([§4.6](#_4-6-expressions-and-records)) |
| `"..."`, `"""..."""` | string, raw string |
| numbers, `true`, `false`, `nil` | literals |
| `'x` `` `x `` `~x` `~@x` | quote family; `quote` gains evaluation semantics (returns the datum) |
| `;` | line comment |

Removed: the Set heuristic (`{a b}` is an ordinary map, and an odd count remains a read
error). Map keys in record literals must be keywords; maps with string keys are
`Map` values; symbol keys are an error with a hint.

### 4.2 Naming

| Kind | Case | Examples |
| --- | --- | --- |
| Types, constructors, classes, errors, services, layers | `PascalCase` | `Order`, `Some`, `OrderNotFound`, `UserRepo` |
| Values, functions, forms, fields, keywords | `kebab-case` | `total-cents`, `find-by-email`, `entity` |
| Namespaced names | `ns/name` | `employee/name`, `_schema/type` |
| Member access | `owner.member` | `order.total-cents`, `UserRepo.find`, `Employee.last-name` |
| Type variables | lowercase | `a`, `e` |

`:` appears only as the keyword prefix and the `(:` signature head. Identifier strings
such as `"employee:ada"` are data and unaffected.

### 4.3 Types

```text
Type :=
  | Unit | Bool | Int | Number | String | Keyword | Symbol      ; primitives
  | Name | (Name Type ...)                                      ; declared or applied type
  | a                                                           ; type variable
  | :kw | "str" | 42 | true                                     ; literal types
  | {:key Type ... }  |  {:key Type ... & r}                    ; record (closed / open row)
  | (List Type) | (Map Key Type) | (Option Type) | (Result A E)
  | (Union Type ...)                                            ; untagged union
  | (Tagged Ctor ...)  where Ctor := Name | (Name Type)         ; tagged sum
  | (Brand Type)                                                ; only as a whole `type` body
  | (-> Type ... Type)
  | (Effect A) | (Effect A [E ...]) | (Effect A [E ...] [R ...])
  | (Type :meta value ...)                                      ; metadata on any type
```

Rules:

- **Canonical names only.** `Str`, `Num`, `Boolean`, `Nil`, `Array`, `Vector` and the
  lowercase aliases (`string`, `integer`, `object`, ...) are removed. `[1 2]` has type
  `(List Int)`.
- **Records are required-by-default.** A key whose type is `(Option T)` is optional on
  the wire (encoded as a missing key). In a record literal checked against a known record
  type, an omitted `Option` key is `None` and a present key's value is checked at `T` and
  wrapped. Reading always yields `(Option T)`.
- **Metadata lives on types.** `(String :doc "Display name" :pattern "^[a-z]+$")`. Each
  consumer declares the metadata keys it understands; unknown keys are diagnostics, not
  silently dropped.
- **`Union` is untagged.** Enums are unions of keyword literals: `(Union :free :pro)`.
  Values are `:free`; the wire projection is `"free"`.
- **`Tagged` declares constructors.** Every arm is a constructor; a bare name is nullary.
  The tag field defaults to `_tag` and can be renamed with `(Tagged :tag kind ...)`. A
  record payload is merged into the tagged object; any other payload is stored under
  `:value`. Constructors are scoped to their type; bare use is resolved by expected type,
  and `Discount.None` is always unambiguous.
- **`(Brand T)` takes its name from the declaration.**
- **`Ref` means Effect's `Ref` only.** Inside types, refer to other types by bare name.
  Entity references are `(Id Entity)` (domain prelude).
- **`Map` keys** must be `String`, a brand of `String`, or a union of keyword/string
  literals.
- **Kinds are inferred.** The `(f : (-> * *))` annotation syntax is removed.

### 4.4 Declarations

| Head | Declares | Effect TypeScript |
| --- | --- | --- |
| `(type Name Type)`, `(type (Name a ...) Type)` | a structural type (alias, record, union, sum, brand) | `Schema.*` const + `type` |
| `(class Name {...})` | a nominal record with a constructor | `Schema.Class` |
| `(error Name {...})`, `(error Name)` | a nominal, tagged, yieldable error | `Schema.TaggedError` |
| `(service Name (: member Type) ...)` | a capability interface | `Context.Service` |
| `(layer Name :provides S :setup [...] (define ...) ...)` | a service implementation | `Layer.succeed` / `Layer.effect` |
| `(layer Name expr)` | a composed layer | `Layer.provide` / `Layer.mergeAll` |
| `(typeclass (Name a) :extends [...] (: member Type) ...)` | a typeclass | n/a |
| `(instance (Name T) (define ...) ...)` | a typeclass instance | n/a |
| `(define name value)`, `(define name [params] body ...)` | a value or function | `export const` |
| `(: name Type)` | a signature, anywhere in the same module | |
| `(form ...)`, `(macro ...)` | a form or macro ([§4.10](#_4-10-forms-and-macros)) | |

```lisp
(type OrderId (Brand String))
(type Role    (Union :admin :member))
(type Point   (List Number))
(type User    {:id UserId :name String :role Role :nickname (Option String)})
(type Shape   (Tagged :tag kind (Circle {:radius Number}) (Square {:side Number})))
(type (Maybe a) (Tagged (Some a) None))

(class Customer {:id String :name String :tier Tier})
(error UserNotFound {:id UserId})
(error Timeout)
```

Prelude-specific options use trailing pairs on the same heads, for example the HTTP
prelude's `(error DatabaseNotFound {:database String} :status 404)`. There is one grammar
per head; consumers validate the options they register.

### 4.5 Bindings and functions

```lisp
(: area (-> Shape Number))
(define area [shape]
  (match shape
    (Circle {:radius r}) (* 3.14159 r r)
    (Square {:side s})   (* s s)))

(define tau 6.28318)                       ; value
(define inc (fn [x] (+ x 1)))              ; explicit fn still fine
(let [x 1 {:keys [a b]} rec [h & t] xs] ...)
```

- `(define name [params] body ...)` is the function form. The list-headed
  `(define (f x) ...)` sugar (unused in the repository) is removed.
- Parameters are bare names or destructuring patterns; types come from `(: ...)`.
- A signature may appear before or after its definition anywhere in the module (the
  Effect pipeline already allows this; the core lowering is aligned with it).
- `(: expr Type)` in expression position remains ascription.

### 4.6 Expressions and records

| Form | Notes |
| --- | --- |
| `{:k v ...}` | record literal |
| `x.k`, `x.k.j` | field access when `x` is a local or parameter |
| `Service.member` | service member (unchanged) |
| `Entity.attribute` | attribute reference (domain prelude) |
| `(get m k)` | `Map` lookup returning `(Option V)`; `k` is evaluated |
| `(assoc r :k v)`, `(dissoc m k)` | update |
| `if when unless cond -> ->> do and or not` | unchanged; `unless` becomes a kernel macro so every pass has it |

Member access resolves by scope during lowering: if the first segment is a local, it is
a field path; if it is a service, a member; if it is an entity, an attribute. Keywords
are never split.

### 4.7 Patterns

One pattern language for `match`, `catch`, `let` and `fn`:

| Pattern | Matches |
| --- | --- |
| `_` | anything, binds nothing |
| `name` (lowercase) | anything, binds `name` |
| `Name` (capitalised) | nullary constructor |
| `(Name p)` | constructor with payload |
| `:kw`, `"s"`, `42`, `true`, `nil` | literal |
| `{:k p ...}`, `{:keys [a b]}` | record / map |
| `[p ... & rest]` | sequence |

`Option` and `Result` use their constructors: `(Some x)`, `None`, `(Success v)`,
`(Failure e)`. A catch-all handler is a binder: `(catch eff (NotFound e) h1 err h2)`.
`match` on strings or numbers still needs a final `_` or binder.

### 4.8 Effects, services and layers

```lisp
(service Clock
  (: now (Effect Int)))                              ; zero-argument member is an effect value

(service Orders
  (: find (-> OrderId (Effect Order [OrderNotFound])))
  (: save (-> Order (Effect Unit))))

(: ship (-> OrderId (Effect Order [OrderNotFound] [Orders Clock.now])))
(define ship [id]
  (do! [order (Orders.find id)
        now   Clock.now
        :let  [shipped (assoc order :status :shipped :shipped-at now)]
        _     (Orders.save shipped)]
    shipped))

(layer OrdersMemory
  :provides Orders
  :setup    [store (ref-make (: {} (Map OrderId Order)))]
  (define find [id]
    (do! [orders (ref-get store)]
      (match (get orders id)
        (Some order) order
        None         (fail (OrderNotFound {:id id})))))
  (define save [order]
    (ref-update store (fn [orders] (assoc orders order.id order)))))

(layer AppLive (layer-provide ShippingLive (layer-merge OrdersMemory ClockLive)))
```

- **Trailing `Effect` slots are optional.** `(Effect A)` = no errors, no requirements.
  Service members may not list requirements. The same rule applies to
  `(Stream A [E] [R])`, `(Fiber A [E])` and `(Layer [Provides] [E] [R])`.
- **No `define-operation`.** A `define` whose signature returns `Effect` has an effect
  body. A zero-argument effect is a value: `(: admin-names (Effect (List String) [] [UserRepo.all]))`
  and `(define admin-names (do! ...))` generates `export const adminNames = Effect.gen(...)`.
- **`do!` gains `:let`.** `:let [x v ...]` inside the binding vector binds pure values,
  following Clojure's `for`. `<-`, `let`+`<-`, and bare `<-` in `do` are removed.
- **Tail positions lift.** A tail expression of plain type `T` in an effect body (including
  the tails of `if`, `cond` and `match` branches) is lifted with `succeed`. `succeed`
  remains for non-tail use.
- **Layers implement members with `define`.** Names must match the service; types come
  from the service signature. Helpers that are not service members are allowed and stay
  private to the layer.
- **Requirements stay explicit** in signatures, at capability (`Users.find`) or service
  (`Users`) granularity.

### 4.9 Typeclasses

```lisp
(typeclass (Functor f)
  (: fmap (-> (-> a b) (f a) (f b))))

(typeclass (Ord a) :extends [(Eq a)]
  (: compare (-> a a Int)))

(instance (Functor List)
  (define fmap [f xs] (map f xs)))
```

Members use the same `(:` signatures as services. (The parallel is deliberate:
service : layer :: typeclass : instance.)

### 4.10 Forms and macros

The meta layer is `type` (for IR and syntax types), `form`, `macro`, and ordinary
`define`d helper functions.

```lisp
(form (HEAD pattern ...)
  "Docstring."
  :types    {:var Type ...}          ; types of pattern variables (a record type over the syntax)
  :ir       IRType                   ; the payload contract
  :type     Type-or-fn               ; expression type of the form (default: the Declares type, else Unit)
  :scope    {:var fn ...}            ; extra bindings visible while checking a hole
  :check    fn                       ; extra validation returning diagnostics
  :examples [...]                    ; documentation and completion
  body)                              ; ordinary Forma that builds the IR value
```

**Patterns** are written as the author writes the form:

| Pattern element | Matches |
| --- | --- |
| `name` | one positional item |
| `{:keys [a b]}` | trailing `:a v :b v` options, in any order |
| `x ...` | zero or more remaining items (child forms) |

**Hole types** decide how a hole parses and checks:

| Hole type | Parses as |
| --- | --- |
| `(Declares T)` | a fresh symbol, bound at module scope with type `T` |
| `(Refers T)` | a symbol that must resolve to a declaration of type `T` |
| `Symbol`, `String`, `Int`, `Keyword`, ... | a literal of that type |
| `Type` | a type expression |
| `(Expr T)` | an expression checked at `T` (with `:scope` bindings) |
| `(Record T)` | a record type whose members are `T` |
| `(List h)` where `h` is a form name | child forms with that head; the hole holds their IR |
| `(Option H)` | the hole may be absent |

**Derived, not declared.** Phase, bindings, identifier specs, slot specs, payload
contract, summary fields, `loc`, completion shapes, and the formatter layout all come
from the pattern, `:types` and `:ir`. Each prelude's forms form its module; the IR union,
`CompiledDeclarations` and catalog are derived from the forms' `:ir` types. Hooks become
optional functions (`:scope`, `:check`, `:type`) used only when a static value is not
enough.

**Engines.** Bodies are ordinary Forma. Both engines compile *projection bodies* (record
and list construction from pattern variables, `map` over children, `or` defaults, field
access, and calls to a fixed set of primitives) natively, and interpret anything else.
Parity is enforced by the engine-parity suite. This replaces hand-written
`define-elaboration` mirrors.

**Macros** share the pattern language and return syntax instead of IR:

```lisp
(macro (when test body ...)
  `(if ~test (do ~@body) nil))

(macro (unless test body ...)
  `(if ~test nil (do ~@body)))
```

Examples:

```lisp
(type EntityIR
  {:kind   "Entity"
   :name   Symbol
   :doc    (Option String)
   :fields (List {:name Keyword :type Type :indexed Bool})})

(form (entity name fields {:keys [doc role id-pattern]})
  "A named record of attributes."
  :types {:name       (Declares SchemaDecl)
          :fields     (Record Type)
          :doc        (Option String)
          :role       (Option String)
          :id-pattern (Option String)}
  :ir    EntityIR
  {:kind   "Entity"
   :name   name
   :doc    doc
   :fields (map (fn [[key type]]
                  {:name    (keyword name key)
                   :type    type
                   :indexed (meta type :indexed false)})
                fields)})

(type QueryIR
  {:kind "Query" :name Symbol :from Symbol :where (Option RuntimeExpr) :select (List Keyword)})

(form (query name {:keys [from where select]})
  "A named read over one entity."
  :types {:name   (Declares QueryDef)
          :from   (Refers SchemaDecl)
          :where  (Option (Expr Bool))
          :select (Option (List Symbol))}
  :scope {:where (fn [{:keys [from]}] (entity-fields from))}
  :type  (fn [{:keys [from select]}] (List (row-of from select)))
  :ir    QueryIR
  {:kind "Query" :name name :from from :where where
   :select (map (fn [field] (keyword from field)) (or select []))})

(form (columns {:keys [gap visible]} child ...)
  "Lays children out horizontally."
  :types {:gap (Option Number) :visible (Option (Expr Bool)) :child (List component)}
  :ir    ComponentIR
  (component "columns" {:gap gap :visible visible} child))

(component-alias entity-table runtime/entity-table)   ; was a 6-line define-form each
```

Protocol carriers become types:

```lisp
(type WorkspaceIR
  {:kind    "Workspace"
   :name    String
   :title   (Option String)
   :persona (Option String)
   :subject (Option String)
   :home    (Option String)
   :views   (Option (List String))})
```

### 4.11 Domain preludes

The ontology, process, document, view and HTTP preludes are re-expressed with `form`.
The author surface becomes:

```lisp
(attribute _schema/type String :doc "Entity type discriminant.")
(attribute _schema/created-at (Option Int) :doc "Creation time in epoch milliseconds.")

(entity Employee                                   ; attribute ids derive as :employee/name ...
  {:name       (String :indexed true)
   :department (Id Department)
   :active     (Option Bool)}
  :doc "A person employed by the company.")

(relation works-at Employee Employer {:since Int})
(seed Candidate "candidate:sam" {:name "Sam Patel"})
(link works-at "employee:ada" "employer:acme" {:since 2020})

(query employee-directory
  :from   Employee
  :where  active
  :select [name department])

(: hire (-> Candidate (Action (Id Employee))))
(define hire [candidate]
  (create! Employee {:name candidate.name :active true}))

(process employee-onboarding
  :description "Onboarding compliance."
  :trigger     (on-create Employee)
  (node generate-tasks :action generate-onboarding-tasks :input {:entity-id context.entity-id})
  (node i9-section-1   :action collect-form :input {:section-ids "employee-information" :assignee-type "entity"})
  (edge generate-tasks i9-section-1))

(document i-9-employment-eligibility
  :description "Verify identity and employment authorization."
  (page employee-information
    :assignee employee
    (content :i9.section1_intro "# Section 1 ...")
    (text :i9.last_name  "Last Name"     :required true :bind Employee.last-name)
    (date :i9.birth_date "Date of Birth" :required true :bind Employee.date-of-birth)))

(workspace staffing :home dashboard :views [dashboard employees placements])
```

- Field keys are short; attribute ids derive from the entity name. A fully qualified key
  (`:jobtype/title`) overrides the namespace.
- `define-meta-entity` becomes `(entity Name {...} :tier :meta)`; near-twin forms
  (`action`/`mutation`, `role`/`group`, `view`/`view-component`) collapse into one form
  with an option.
- Actions and mutations are operations whose effect type is `(Action A)`, the ontology
  runtime's effect alias.
- References are symbols checked at elaboration: entity names, attributes
  (`Entity.attribute` or a bare field inside a query scope), actions, queries and views.

## 5. Before and after: complete programs

### 5.1 `crud-users`

Before: `conformance/effect-typescript/cases/crud-users/program.lisp` (115 lines). After:

```lisp
(type UserId (Brand String))
(type Role   (Union :admin :member))

(type User
  {:id       UserId
   :name     String
   :email    String
   :role     Role
   :nickname (Option String)})

(type NewUser {:name String :email String :role Role})

(error UserNotFound   {:id UserId})
(error DuplicateEmail {:email String})
(error InvalidUser    {:reason String})

(service UserRepo
  (: find          (-> UserId (Effect (Option User))))
  (: find-by-email (-> String (Effect (Option User))))
  (: save          (-> User (Effect Unit)))
  (: remove        (-> UserId (Effect Bool)))
  (: all           (Effect (List User))))

(service Ids
  (: next (Effect UserId)))

(: display-name (-> User String))
(define display-name [user]
  (str (get-or-else user.nickname user.name) " <" user.email ">"))

(: validate (-> NewUser (Effect NewUser [InvalidUser])))
(define validate [input]
  (cond
    (= (trim input.name) "")          (fail (InvalidUser {:reason "name is required"}))
    (not (includes? input.email "@")) (fail (InvalidUser {:reason "email is invalid"}))
    :else                             input))

(: create-user (-> NewUser (Effect User [InvalidUser DuplicateEmail] [UserRepo Ids])))
(define create-user [input]
  (do! [valid    (validate input)
        existing (UserRepo.find-by-email valid.email)]
    (match existing
      (Some _) (fail (DuplicateEmail {:email valid.email}))
      None     (do! [id   Ids.next
                     :let [user {:id id :name valid.name :email valid.email :role valid.role}]
                     _    (UserRepo.save user)]
                 user))))

(: get-user (-> UserId (Effect User [UserNotFound] [UserRepo.find])))
(define get-user [id]
  (do! [found (UserRepo.find id)]
    (match found
      (Some user) user
      None        (fail (UserNotFound {:id id})))))

(: rename-user (-> UserId String (Effect User [UserNotFound InvalidUser] [UserRepo.find UserRepo.save])))
(define rename-user [id name]
  (do! [user (get-user id)]
    (if (= (trim name) "")
      (fail (InvalidUser {:reason "name is required"}))
      (do! [:let [renamed (assoc user :name name)]
            _    (UserRepo.save renamed)]
        renamed))))

(: delete-user (-> UserId (Effect Unit [UserNotFound] [UserRepo.remove])))
(define delete-user [id]
  (do! [removed (UserRepo.remove id)]
    (unless removed
      (fail (UserNotFound {:id id})))))

(: admin-names (Effect (List String) [] [UserRepo.all]))
(define admin-names
  (do! [users UserRepo.all]
    (map display-name (filter (fn [user] (= user.role :admin)) users))))

(: find-or-default (-> UserId String (Effect String [] [UserRepo.find])))
(define find-or-default [id fallback]
  (catch (do! [user (get-user id)] user.name)
    (UserNotFound _) fallback))

(layer UserRepoMemory
  :provides UserRepo
  :setup    [store (ref-make (: {} (Map UserId User)))]
  (define find [id]
    (do! [users (ref-get store)] (get users id)))
  (define find-by-email [email]
    (do! [users (ref-get store)]
      (find (fn [user] (= user.email email)) (vals users))))
  (define save [user]
    (ref-update store (fn [users] (assoc users user.id user))))
  (define remove [id]
    (do! [users (ref-get store)
          _     (ref-set store (dissoc users id))]
      (has-key? users id)))
  (define all
    (do! [users (ref-get store)] (vals users))))
```

What changed: 11 `(field ...)` forms, two `Struct`s and three `(:fields ...)` blocks
become record types; six `[] []` pairs disappear; seven `define-operation`s become
`define`; 14 `(get x :k)` calls become `x.k`; two `(succeed ...)` bindings become `:let`
and tail `succeed`s are dropped; enum values are keywords throughout; layer methods use
the same `define` as everything else.

### 5.2 `pure-domain-logic` (excerpt)

Before (`pure-domain-logic/program.lisp:5-58`):

```lisp
(define-schema Tier (Enum free pro enterprise))
(define-schema Discount
  (TaggedUnion type
    [percent (Struct (field rate Int))]
    [fixed (Struct (field cents Int))]
    [none (Struct)]))

(: tier-discounts (Map Discount))
(define tier-discounts
  {"free" {:type "none"}
   "pro" {:type "percent" :rate 10}
   "enterprise" {:type "fixed" :cents 500}})

(: apply-discount (-> Discount Int Int))
(define apply-discount
  (fn [discount cents]
    (match discount
      (percent p) (- cents (quot (* cents (get p :rate)) 100))
      (fixed f) (max 0 (- cents (get f :cents)))
      none cents)))
```

After:

```lisp
(type Tier (Union :free :pro :enterprise))
(type Discount
  (Tagged :tag type
    (Percent {:rate Int})
    (Fixed   {:cents Int})
    NoDiscount))

(: tier-discounts (Map Tier Discount))
(define tier-discounts
  {:free       NoDiscount
   :pro        (Percent {:rate 10})
   :enterprise (Fixed {:cents 500})})

(: apply-discount (-> Discount Int Int))
(define apply-discount [discount cents]
  (match discount
    (Percent {:rate r})  (- cents (quot (* cents r) 100))
    (Fixed {:cents c})   (max 0 (- cents c))
    NoDiscount           cents))
```

### 5.3 `todo-app`

Before: `examples/todo-app/README.md` (entity, three queries, three actions, one view;
see [§3.7](#_3-7-stringly-typed-references-in-domain-dsls)). After:

```lisp
(entity Todo
  {:title     String
   :completed (Bool :default false)})

(query list-todos
  :from   Todo
  :select [title completed])

(query list-incomplete-todos
  :from   Todo
  :where  (not completed)
  :select [title])

(: add-todo (-> String (Action (Id Todo))))
(define add-todo [title]
  (create! Todo {:title title :completed false}))

(: mark-done (-> (Id Todo) (Action Bool)))
(define mark-done [todo]
  (do! [_ (update! todo {:completed true})] true))

(: delete-todo (-> (Id Todo) (Action Bool)))
(define delete-todo [todo]
  (do! [_ (retract! todo)] true))

(view todo-list-manager
  :title       "Todo List Manager"
  :description "Add todos, inspect all tasks, and run completion or delete actions."
  :subject     session
  :state       {:new-title (String :default "") :selected (Option (Id Todo))}
  :queries     {:todos list-todos}
  (rows
    (heading "Todo List Manager")
    (columns
      (input new-title :label "Task" :placeholder "What needs to be done?")
      (action-button add-todo {:title new-title} :label "Add Todo" :variant :default))
    (table todos
      :columns [(column title "Task")
                (column completed "Done" :kind :boolean)
                (column id "ID" :kind :mono)]
      :empty-state "No todos yet.")
    (columns
      (entity-picker selected :label "Todo" :placeholder "Select todo")
      (when-some [todo selected]
        (action-button mark-done {:todo todo} :label "Mark Complete" :variant :secondary)
        (action-button delete-todo {:todo todo} :label "Delete" :variant :destructive)))))
```

Every reference (`Todo`, `title`, `add-todo`, `list-todos`, `new-title`, `selected`) is a
symbol the elaborator resolves; misspelling one is a located diagnostic instead of a
runtime miss. `entity-picker` infers its entity type from the state's type.

### 5.4 The `entity` form

Before: ~31 descriptor lines, a 38-line `meta-fn`, an 18-line `define-elaboration`, a
payload contract, a protocol object, and four list entries (see [§3.6](#_3-6-the-meta-layer)).
After: the 26-line `EntityIR` type and `entity` form in [§4.10](#_4-10-forms-and-macros),
in one place, with no registration lists.

## 6. Old-to-new reference table

| Current | Proposed |
| --- | --- |
| `(define-schema N (Struct (field a T) ...))` | `(type N {:a T ...})` |
| `(define-schema N (Brand N T))` | `(type N (Brand T))` |
| `(Enum a b)`, `(Literal a b)` | `(Union :a :b)` |
| `(TaggedUnion k [a (Struct ...)] ...)` | `(Tagged :tag k (A {...}) ...)` |
| `(define-type (M a) (C a) (D))` | `(type (M a) (Tagged (C a) D))` |
| `(define-type N T)` | `(type N T)` |
| `(Optional T)`, `{:required true}` (inverted) | `(Option T)` |
| `(Ref X)` inside a schema | `X` |
| entity `(Ref X)` | `(Id X)` |
| `Str Num Boolean Nil Array Vector` | `String Number Bool Unit List List` |
| `(Map V)` | `(Map String V)` |
| `(define-error N (:fields (field a T)))` | `(error N {:a T})` |
| `(define-error N (:fields))` | `(error N)` |
| `(define-class N (:fields ...))` | `(class N {...})` |
| `(define-service S (:methods (m [a T] (Effect R [] []))))` | `(service S (: m (-> T (Effect R))))` |
| `(define-operation f [a] ...)` | `(define f [a] ...)` |
| `(define f (fn [a] ...))` | `(define f [a] ...)` (old form still valid) |
| `(define-layer L (:provides S) (:setup [...]) (:methods (m [a] ...)))` | `(layer L :provides S :setup [...] (define m [a] ...))` |
| `(define-layer L expr)` | `(layer L expr)` |
| `(Effect A [] [])` | `(Effect A)` |
| `(do! [x (succeed v)] ...)` | `(do! [:let [x v]] ...)` |
| `(do! [x (<- e)])`, `(let [x (<- e)])` | `(do! [x e])` |
| `(get (get x :a) :b)` | `x.a.b` |
| `(some x)` / `none` / `(success v)` / `(failure e)` | `(Some x)` / `None` / `(Success v)` / `(Failure e)` |
| `(catch e (_ err) h)` | `(catch e err h)` |
| `(define-typeclass (C a) (m T))` | `(typeclass (C a) (: m T))` |
| `(Functor (f : (-> * *)))` | `(Functor f)` (kind inferred) |
| `(define-macro m [a & b] ...)` | `(macro (m a b ...) ...)` |
| `(define-form define-x ...)` + `meta-fn` + `define-elaboration` + `define-payload-contract` | `(form (x ...) ...)` + `(type XIR ...)` |
| `(define-form x (:extensions (:protocol/object ...)))`, `define-protocol` | `(type X {...})` |
| `(define-entity E (:field [e/a T {:required true}]))` | `(entity E {:a T})` |
| `(define-meta-entity E ...)` | `(entity E {...} :tier :meta)` |
| `(define-record "id" E (:field [e/a v]))` | `(seed E "id" {:a v})` |
| `(define-system-attribute a (:value-type T) (:required true))` | `(attribute a T)` |
| `(define-query q (:from E) (:where ...) (:select [...]))` | `(query q :from E :where ... :select [...])` |
| `(define-action a (:input [x T]) (:returns R) (:do ...))` | `(: a (-> T (Action R)))` `(define a [x] ...)` |
| `(:node (node n ...))`, `(:field (field ...))`, ... | `(node n ...)`, `(text ...)`, ... |
| `{:action-ref "a" ...}`, `":e/a"`, `"?col"` | `a`, `Entity.a`, `col` |
| `(define-workspace w (:view a) (:view b))` | `(workspace w :views [a b])` |
| `{a b}` (Set) | removed |

## 7. Alternatives considered

**Keep the `define-` prefix.** The smallest fix for `define-form define-entity` is to
name the form `entity` and derive the `define-entity` head. This keeps greppability and
the existing convention. Rejected as the final state because the prefix is pure noise at
top level and inconsistent with `fn`, `let`, `instance` and `meta-fn`; kept as a fallback
if noun heads prove too collision-prone ([§9](#_9-risks)).

**Everything is a value** (`(define Order (Struct ...))`, `(define NotFound (Error {...}))`).
This mirrors Effect TypeScript, where schemas are consts. Rejected because nominal
declarations need their own name (for `_tag` and the class), so `Error`, `Class` and
`Brand` would only be legal directly under `define`. A constructor that is only legal in
one position is a declaration form in disguise, and the head would stop telling the
reader what kind of thing is declared.

**`(Struct (field ...))` everywhere.** Making `Struct` the body of `error` and `class` is
the minimal unification and remains a valid first step. Rejected as the end state because
record types would not mirror record values, and `field` would keep colliding with the
domain preludes.

**Inline parameter types** (`(define f [(x Int)] ...)` or `[x :- Int]`). Rejected: types
would live in two places (signature or binder), and separate signatures are what make
APIs reviewable at a glance.

**Clause options `(:key value)`.** Clauses map neatly to outline nodes in structural
editors. Rejected because they force wrapper stutter for child forms and disagree with
combinator options; the outline codec can treat a `:key value` pair as one node.

**Racket `syntax-parse` annotations (`name:id`) in form patterns.** Compact and
well-precedented. Rejected in favour of a `:types` record so hole types use the one type
language and the parsed syntax is itself a record type.

**One `Union` for both tagged and untagged sums.** Rejected because a capitalised arm
would be ambiguous between a nullary constructor and a type reference
(`(Union (List a) (Some a))`).

## 8. Implementation plan

### 8.1 Strategy

- **Semantics first, then syntax, then the meta layer, then domain surfaces.** Each phase
  is independently shippable and leaves every suite green.
- **Clean grammar boundary.** The canonical forms replace the old authoring grammar.
  Migration moves existing source; compiler projections remain private implementation
  details. This greenfield project has no compatibility window.
- **Golden equivalence.** For every conformance program, the migrated source must produce
  the same artifacts, generated TypeScript and diagnostics as the original, except for
  differences listed in the PR. A small harness compares old and new outputs per case.
- **Automated migration.** A `forma migrate` command applies rewrite rules over the
  lossless tree using the outline codec and id-addressed edit scripts (PRs #19, #20), so
  comments and formatting survive. The rule table is [§6](#_6-old-to-new-reference-table).
  This also dogfoods the structural editing services.
- **New spans point at new source.** Every desugaring reuses child nodes so diagnostics
  keep pointing at what the author wrote.

### 8.2 Phase 0: semantic fixes (no syntax change)

Each item lands with a fixture in `conformance/fixtures` or `conformance/engine-parity`.

| Item | Files |
| --- | --- |
| Keyword token and literal type in TS; parity with OCaml `TKeyword` | `ts/src/reader/lexer.ts`, `type/lower-core.ts:114`, `evaluator/eval-core.ts:112`, `type/infer-core.ts:479-484` |
| Remove the Set heuristic | `ts/src/reader/green-tree-builder.ts:301-341`, `type/type-parser.ts:152` |
| Implement `quote`; move `unless` to the kernel | `evaluator/eval-core.ts`, `vm/compile-core.ts:288`, `preludes/kernel.lisp` |
| Runtime ADT constructors and constructor patterns | `evaluator/match.ts`, `vm/compile-core.ts:279-282` |
| Align `(get m v)` and map-key labels across passes | `type/lower-control.ts:108`, `type/lower-core.ts:139-146`, `eval-core.ts:180-188` |
| Report unknown slots and option keys in TS like OCaml | `descriptor/normalize.ts:132`, `:277-283` |
| Fix `compiler.lisp` (vector descriptors, duplicate `meta-fn`) | `preludes/compiler.lisp:43-238` |
| Reconcile static `:construct` blocks with hooks; remove reads of undeclared slots | `preludes/ontology.lisp`, `preludes/ontology-compiler.lisp` |
| Effect diagnostics: unknown metadata keys, `Optional`/`Option` misuse, `define-class` message | `mechanics/effect-schema.ts:128`, `mechanics/artifact.ts:335`, `:1592-1606` |

Size: ~8 small PRs.

### 8.3 Phase 1: Effect surface

The Effect pipeline reads raw parsed forms (`mechanics/elaborate.ts:54-94` →
`mechanics/artifact.ts`) and only TypeScript emits Effect code, so this phase is
TypeScript-only.

1. **Types.** Parse `{:k T}` record types, `(Option T)` fields, `(Union ...)` of literals,
   `(Tagged ...)`, `(Brand T)` with a derived name, `(List T)`, `(Map K V)`, type metadata
   validation. Files: `mechanics/artifact.ts` (`schemaExprToJson`, `typeExprToJson`),
   `mechanics/types.ts`, `mechanics/effect-schema.ts`, `mechanics/effect-typescript.ts`.
2. **Declarations.** `type`, `error`, `class`, `service` with `(:` members, `layer` with
   `define` members, `define` with effect bodies (retire `define-operation`), zero-argument
   effect values. Files: `mechanics/artifact.ts:60-400` (form recognisers and declaration
   builders), `mechanics/elaborate.ts:179-235` (usage strings), `mechanics/check.ts`.
3. **Bodies.** Optional `Effect` slots, `:let` in `do!`, tail lifting, dot access,
   keyword enum literals, unified patterns (`Some`/`None`, binder catch-all), constructor
   patterns with record destructuring. Files: `mechanics/artifact.ts` (body projection),
   `mechanics/check.ts` (`match`/`catch` rules at `:1271`, `:2711`).
4. **Migrate** `conformance/effect-typescript`, `conformance/operational-effects`,
   `docs/snippets/effect`, `apps/website/src/pipelines`, `apps/website/src/effectPageSources.ts`,
   `docs/effect.md`, `docs/effect/reference.md`, and the README with `forma migrate`.
   Regenerate expected outputs; generated TypeScript should be unchanged except for
   intended differences (zero-argument effects become consts; `Literals` keep their values).
5. **Remove** the old Effect forms.

Size: ~6 PRs. This phase is the highest-value, lowest-risk slice and can start
immediately after Phase 0's keyword fix.

### 8.4 Phase 2: core language (both engines)

1. `type` replaces `define-type`, with `Tagged` and `Union`; canonical type names; open
   rows `{... & r}`; inferred kinds. Files: `type/lower-typedef.ts`, `type/type-parser.ts`,
   `type/infer-core.ts:114-183`, OCaml counterparts in `packages/ocaml/lib`.
2. `define name [params]`; signatures anywhere in a module (`type/lower.ts:47-135`); one
   pattern language (`type/lower-control.ts:63-100`, `evaluator/match.ts`,
   `type/lower-destructure.ts`); member access lowering.
3. `macro` with ellipsis patterns; `typeclass` with `(:` members
   (`type/lower-typedef.ts:597-721`).
4. Migrate `conformance/fixtures`, `conformance/forma-zero`, `conformance/engine-parity`,
   `preludes/kernel.lisp`, docs. Update `conformance/engine-parity/matrix.json`.
5. Remove old forms in both engines.

Size: ~8 PRs, about half in OCaml.

### 8.5 Phase 3: meta layer

1. **`type` for IR.** Teach the descriptor loader to accept `(type X {...})` wherever it
   accepts `:protocol/object`, `:protocol/union` and `define-payload-contract`, generating
   the same internal protocol objects and contracts. Files:
   `ts/src/descriptor/parse-descriptor.ts:404-490`, `ocaml/lib/artifact_payload_descriptor.ml`,
   `ts/src/artifact/artifact.ts:97-160` (replace the hard-coded table).
2. **Convert carriers.** Rewrite the syntax-less `define-form`s in
   `ontology-ir.lisp`, `query-protocol.lisp`, `action-protocol.lisp` and
   `viewspec-protocol.lisp` as types, and derive module object lists. Mechanical; one PR
   per file.
3. **`form` front-end.** Compile `(form ...)` into the existing `FormDescriptor`
   (`ts/src/descriptor/FormDescriptor.ts`) plus a construct hook and payload contract, so
   the elaboration engine is unchanged at first. Same in OCaml (`ocaml/lib/descriptor.ml`).
4. **Native projection bodies.** Classify form bodies; compile projection bodies natively
   in both engines (subsuming `ts/src/descriptor/ElaborationDescriptor.ts` and the OCaml
   elaboration executor); parity-test against the interpreted path.
5. **Convert forms** in `ontology.lisp` + `ontology-compiler.lisp`, `ui.lisp`,
   `viewspec.lisp`, one family per PR, deleting the matching `meta-fn`,
   `define-elaboration` and contract each time. Regenerate
   `ts/src/preludes/sources.generated.ts`.
6. **Remove** `define-form`, `meta-fn`, `define-elaboration`, `define-elaboration-primitive`,
   `define-payload-contract`, `define-protocol` and the hand-maintained lists.

Size: ~12 PRs. The largest phase; most PRs are mechanical conversions verified by golden
equivalence on `conformance/fixtures/canonical-ir` and the examples corpus.

### 8.6 Phase 4: domain surfaces

1. Noun heads, `:key value` options and wrapper-free children for every domain form
   (falls out of Phase 3's patterns).
2. Entity short keys with derived namespaces; `(Id E)`; `attribute`, `seed`, `link`.
3. Typed references in actions, views, documents and processes; `Entity.attribute`.
4. Actions and mutations as operations with `(Action A)`.
5. Migrate `examples/`, `apps/website`, README, docs.

Size: ~8 PRs.

### 8.7 Phase 5: tooling and documentation

These track each phase rather than waiting for the end:

- Editor symbols and outline: `ts/src/editor/symbols.ts:127, 451, 701`,
  `language-server/src/symbols.ts`.
- Slot affordances and completion derive from `form` patterns (PR #21's machinery).
- Formatter layouts derive from patterns (`ts/src/Formatter.ts`).
- Syntax highlighting keyword lists in `packages/editor`.
- Docs: rewrite `docs/language.md` as the language reference; update `docs/effect/reference.md`;
  add a "Writing a form" guide replacing descriptor documentation.

### 8.8 Sequencing

```text
Phase 0 ──┬── Phase 1 (Effect, TS only) ──────────────┐
          └── Phase 2 (core, both engines) ── Phase 3 (meta) ── Phase 4 (domain) ── done
Phase 5 runs alongside each phase
```

Phases 1 and 2 can proceed in parallel after Phase 0. Phase 3 depends on Phase 2's `type`
and pattern work. Roughly 40–45 PRs in total.

### 8.9 Testing

- Every new rule gets positive and negative fixtures (`expected-diagnostics.json`), with
  diagnostics pointing at author spans.
- Golden-equivalence runs on every migration PR.
- Engine parity for every Phase 0, 2 and 3 change.
- The Effect suite keeps typechecking and executing generated programs.
- `forma migrate` is idempotent and is itself tested on the full corpus.

## 9. Risks

| Risk | Mitigation |
| --- | --- |
| **Noun heads collide** with expression vocabulary (`(query todos)` inside view layouts, a runtime `error` function). | Declaration heads are recognised only at top level; nested vocabulary is scoped by the enclosing form's hole types. Fallback: keep `define-` heads derived from the form name. |
| **Dot access is ambiguous** between field paths, service members and attribute refs. | Resolution by scope at lowering, with a diagnostic on shadowing (a local named like a service). Keywords are never split. |
| **`Option` coercion in record literals** adds an implicit rule. | Limited to record literals checked against a known type; documented; covered by fixtures. Alternative in [§10](#_10-open-questions). |
| **Keyword semantics change** breaks stored data that contains `":todo/title"` strings. | Wire projection of keywords is defined explicitly; the ontology runtime keeps accepting the string form during migration. |
| **Native projection bodies** diverge between engines. | Projection subset is small and fixed; parity suite compares native and interpreted results for every form. |
| **Span loss** during desugaring or migration. | Desugarings reuse child nodes; migration operates on the lossless tree; span fixtures per rule. |
| **Scale of migration** (268 `(:fields` across 45 files, 348 `define-form`s). | Automated `forma migrate`, one family per PR, golden equivalence. |

## 10. Open questions

1. **Tag values.** Capitalised constructors produce `"Percent"` tags. Existing data uses
   lowercase (`{:type "percent"}`). Options: keep capitalised tags (Effect convention), or
   allow `(Percent :as "percent" {...})`.
2. **Field names in generated TypeScript.** Kebab fields are emitted verbatim and quoted
   (`"total-cents"`). Camel-casing them would change the wire format unless schemas use
   key renaming.
3. **Numeric tower.** Whether `Int` is a subtype of `Number`, a distinct type with
   explicit conversion, or resolved through a typeclass.
4. **`Option` in record literals.** Implicit lifting (proposed) versus requiring
   `(Some x)`.
5. **Form bodies.** Whether to restrict form bodies to the projection subset (simpler
   engines, less power) or allow general Forma with native compilation as an optimisation
   (proposed).
6. **`CanonicalIR`.** Derive the IR union from a prelude's forms automatically, or keep
   one explicit `(type CanonicalIR (Union ...))`.
7. **Zero-argument service members** as effect values (proposed) or thunks.
8. **Kind annotations** if inference is insufficient for some typeclasses.
9. **Seed data naming.** `seed`, `fact`, or `data` for today's `define-record`.
10. **Whether to keep `define-*` heads as permanent aliases** for users who prefer them.
