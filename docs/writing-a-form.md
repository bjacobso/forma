# Writing a form

Use `form` for new definitions. `define-form` is legacy, retained only for
existing preludes pending migration. The checked-in preludes already use `form`.
The repository check fences remaining historical occurrences with a reviewed
file-and-count allowlist.

Define the output type and the syntax together. A form's pattern supplies its
positional arguments, options, and children; `:types` describes the holes;
`:ir` checks the projected value and derives its artifact contract.

```lisp
(type GreetingIR
  {:kind "Greeting" :name Symbol :message String :doc (Option String)})

(define greeting-message [message] (str "Hello, " message))

(form (greeting name message {:keys [doc]})
  "Declare a greeting."
  :types {:name (Declares Greeting) :message String :doc (Option String)}
  :ir GreetingIR
  {:kind "Greeting" :name name :message (greeting-message message) :doc doc})

(greeting welcome "Ada" :doc "Shown on arrival")
```

In file modules, running this application binds `welcome` to the elaborated
declaration descriptor. Its `:data` field holds the projected `GreetingIR`.
The application evaluates to that descriptor; an application without a declared
name evaluates to its projected IR. Runtime evaluation reuses elaboration and
does not run `:check` or the projection again.

`welcome` is a declaration name, `"Ada"` is a string literal, and `:doc` is
optional. Unknown options are errors. The optional IR field disappears from
the wire object when the author leaves it absent.

Use `(Refers Greeting)` for a hole that must resolve to an existing greeting.
Use `Type` for a type expression, `Syntax` for syntax retained as data, and
`(Expr Bool)` for an ordinary expression checked as a predicate. `(Record Type)`
accepts a record of type expressions. A pattern ending in `child ...`, paired
with `(List child)` in `:types`, parses and projects each child before passing
its value to the parent. Here `child` is a form name or a lowercase category
alias, such as `(type child (Union TextIR ImageIR))`. A record IR type by itself
does not identify which child forms may appear. A child's diagnostics point at
the child, not at the parent application.

Hole and IR types may refine `String`, `Int`, `Float`, and `List` with metadata:
`(String :pattern "^[a-z]+$" :min-length 1 :max-length 40)`, `(Int :min 0 :max 10)`, `(Float :finite true)`,
or `(List String :max-length 3)`. A literal in a refined hole is checked where
the author wrote it, and the projected IR is checked against its declared
refinements. A hole typed with an enum alias such as
`(type Status (Union "active" "inactive"))` accepts only its members.

## Checking and scope

Add `:check` when the syntax needs rules beyond its hole types. The function
receives a record of the holes and returns a list of diagnostic records.

Record parameter patterns, including `{:keys [...]}`, require every named key.
A shared check can destructure holes declared by each form that uses it;
an omitted optional hole is still a key whose value is `nil`. Destructuring a
hole the form never declares fails with a diagnostic naming the check, form,
and missing holes, such as `:check shared/check of form a: no hole named extra`.
To share a check across forms with different holes, accept the whole record
and use `(get holes :extra)`, which returns `nil` when the key is absent.

Hooks receive plain runtime values, not `Option` values: an `(Option T)` hole is
`nil` when omitted and the bare value when supplied. Test it in the hook with
`(= (get holes :doc) nil)`; matching it against `Some`/`None` fails at run time,
and a typed helper that compares a parameter with `nil` infers that parameter
as `Unit`. A check may call helpers defined in the form's module and helpers
that module imports. If a hook fails while running, the module reports
`elaborate/hook-failed` at the form application, and every failing application
is reported in one run. See [Authoring your own program](./authoring.md) for
the file commands that elaborate forms and list their IR.

```lisp
(form (greeting name message {:keys [doc]})
  :types {:name (Declares Greeting) :message String :doc (Option String)}
  :ir GreetingIR
  :check (fn [{:keys [message]}]
    (if (= message "")
      [{:severity :error :code "greeting/empty"
        :message "Provide a greeting message." :slot :message}]
      []))
  {:kind "Greeting" :name name :message message :doc doc})
```

The optional `:slot` attaches the diagnostic to that authored hole. `:at` can
name a value read from a `Syntax` hole, such as one entry of a record, to point
at that value's source. It can also be a constructed path: the first step names
a hole, an integer selects an item, a keyword selects the value after that
option, any name selects a record key, and a quoted symbol selects the child
form named by its first argument. `[:child (quote second) :limit]` points at the
`:limit` value of `(item second :limit 2)`. A path stops at the deepest resolved node. A value read
from a `Syntax` hole keeps its source even when it is a list or vector; use a
new list or vector to construct a path. Without a resolved `:at`, `:slot` is used,
then the application span. Child forms keep their own diagnostic codes and spans.

Diagnostic records can also include `:details` (a record of structured values),
`:help` (author advice), and `:fix` (a list of source replacements):

```lisp
{:code "greeting/empty" :severity :error :message "Provide a greeting message."
 :details {:hole "message" :actual ""} :help "Write a non-empty greeting."
 :at [:message]
 :fix [{:at [:message] :new-text "\"Hello\""}]}
```

Each edit requires a `:new-text` string and an `:at` that resolves to authored
syntax; it never falls back to the whole application. Consumers receive
`{span, newText}` edits and must apply them atomically against the unchanged
source version. Forma does not apply them automatically. Register consumer
codes in a project-local `DiagnosticCatalog` from `@forma-language/forma/diagnostic`
to share explanations with engine codes. Code identifiers and documented
detail fields are API; message wording is not. See the
[consumer upgrade note](./consumer-upgrade-1317204.md) for typed TypeScript use.

Checks and projections can reflect on other declarations:
`(declaration-fields name)` returns a declaration's record fields,
`(declaration-hole name :hole)` its authored hole,
`(declarations-of 'form)` the names declared by a form, and
`(type-definition 'Name)` an author type alias. An optional positional
`(Option String)` hole, such as a docstring, consumes only a string literal and
may be omitted before other positional arguments.

Severity is `:error`, `:warning`, or `:info`;
warnings and informational diagnostics remain attached to successful artifacts.

An expression hole can introduce local bindings with `:scope`. Type, row, and
effect variables in these signatures are quantified: each use instantiates
them freshly, independently of other bindings using the same variable names.
Each entry maps a hole name to a function returning a record of names and quoted types:

```lisp
:types {:where (Expr Bool)}
:scope {:where (fn [holes] {:active (quote Bool)})}
```

Those bindings apply while checking `where`. The ontology query form uses this
to expose the fields of its selected entity. A scope may also bind functions.
Their type variables are generic, so `{:present? (quote (-> (Option a) Bool))}`
applies to bindings of different types in one expression. Enum aliases keep
their members: `(= status "actve")` against `Status` is an error. `:type` supplies a constant result
type, or a function computing a type from the holes, independently of the
artifact's IR type.

## Reflection in checks and projections

These builtins run in form hooks during elaboration; they are not general
runtime reflection APIs. Declaration names are registered before hooks run,
so reflection can see declarations written later in the program.

| Call | Result |
| --- | --- |
| `(declarations-of 'entry)` | List of symbols declared by the named form, in declaration order; `[]` if none match. This selects the form name, not the declaration's result type. |
| `(declaration-hole 'first :doc)` | The authored hole as data, or `nil` when absent. This includes optional positional docstrings. |
| `(type-definition 'Profile)` | The author's type definition as data, falling back to the prelude's definition, or `nil` for an unknown name. Metadata such as `:doc` is stripped recursively; referenced aliases remain symbols. |

For example, given `(type Status (Union :draft :sent))`,
`(type-definition 'Status)` returns `(Union :draft :sent)` as data. A record
alias such as `(type Profile {:name String :state Status})` returns the map
`{:name 'String :state 'Status}`. These are type syntax values, not runtime
schema objects. A form can return them in a `Json` IR field to let its host
inspect the definition; the union above projects to `["Union", ":draft", ":sent"]`.

## Projection and generated consumers

Projection bodies are ordinary pure Forma expressions. They can call helpers,
use local bindings, and branch. Elaboration checks the declared contract;
a body that returns the wrong shape produces a diagnostic at elaboration.
Built-in (native) projection is an optimization of this behavior.

Hosts that recheck documents can reuse their bootstrapped prelude. Unchanged
form descriptors reuse expanded hook programs, while evaluation still uses the
current holes and semantic environment. The kernel macro prelude is shared
across hooks, including hooks with different host builtins.

Protocols and schemas derive from `type` declarations. Completion, option
availability, declaration bindings, and form layout derive from the form
pattern and hole types. Add another form by writing another definition;
registration tables and separate payload contracts are unnecessary.

Forms can also define `:emit (fn [ir] ...)`, returning a quasiquoted target
TypeScript expression over projected IR. `emitFormTypeScript` evaluates these
hooks, and `generateFormBuilders` derives builders for a restricted set of
typed holes and record projections. See [Prelude-defined HTTP APIs](./effect/http-api.md)
for the shared emitter and builder example and its current limits.

Actions use the same type syntax: `(: hire (-> Candidate (Action (Id Employee))))`.
Their effect bodies use `do!`, `create!`, `update!`, and the other ontology
operations. Generated Effect TypeScript exposes these operations through the
`OntologyRuntime` service, so a host supplies their persistence behavior.

## Documentation and examples

Put a docstring immediately after the form pattern. Use `:examples` for a vector
of programs, each represented by a vector of source forms:

```lisp
(form (greeting name message {:keys [doc]})
  "Declare a greeting."
  :examples [[(greeting welcome "Ada")]]
  :types {:name (Declares Greeting) :message String :doc (Option String)}
  :ir GreetingIR
  {:kind "Greeting" :name name :message message :doc doc})
```

Programs may include setup declarations before the example application. Source
strings are also accepted, such as `:examples ["(greeting welcome \"Ada\")"]`.
These examples are descriptor documentation: defining a form neither evaluates
them nor captures helpers referenced only by them. Consumers can read the
source strings through `FormDescriptor.examples` or the registry's `getExamples`.

The repository reference renders each example. `pnpm check` requires a docstring
and at least one example for every form in a domain prelude, then checks each
example against that prelude's bootstrap stack. Protocol preludes are exempt.
The Elm, email, and HTTP examples also pass their respective TypeScript linker;
this checks generation, while the existing conformance suites separately check
emitted TypeScript and runtime harnesses. Run `pnpm check:preludes` after building
the engine for just the prelude documentation check.

## Extension metadata

A form can carry constant metadata for editors, hosts, and other consumers. The
compiler treats namespace names and their contents as data:

```lisp
(form (greeting name message {:keys [doc]})
  "Declare a greeting."
  :extensions {:catalog/display {:label "Greeting" :category :copy
                                 :fallback nil}}
  :types {:name (Declares Greeting) :message String :doc (Option String)}
  :ir GreetingIR
  {:kind "Greeting" :name name :message message :doc doc})
```

`:extensions` requires a literal map with string or keyword keys. Values may be
strings, numbers, Booleans, `nil`, keywords, vectors, or nested literal maps.
Keywords become strings without their colon, and `nil` becomes null. Calls,
ordinary symbols, quoted expressions, and duplicate normalized keys are errors
at their source locations. The parser never evaluates this configuration.
Explicit namespaces override the same namespace derived from the IR type;
other derived namespaces are retained. Hole and IR validation still use their
typed contracts. Imported forms retain their metadata.

Load `compiler.lisp` to use the domain-neutral `named-map` macro in projections:

```lisp
(let [gap 8 visible false]
  (named-map gap visible))
; Produces {"gap" 8 "visible" false}.
```

Arguments must be distinct identifier symbols. The macro preserves spelling,
lexical binding, insertion order, and nil-valued entries; no arguments produces
an empty map. This is a prelude macro for projections and explicit macro
libraries, rather than an addition to the separate Effect mechanics dialect.
IR bodies still provide their literal kind fields explicitly. See
[RFC 0023](https://github.com/bjacobso/forma/blob/main/docs/rfcs/0023-form-extensions-and-named-maps.md)
for the design and compatibility policy.
