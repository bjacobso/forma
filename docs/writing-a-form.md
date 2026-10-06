# Writing a form

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
does not identify which child forms may appear.

## Checking and scope

Add `:check` when the syntax needs rules beyond its hole types. The function
receives a record of the holes and returns a list of diagnostic records.

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

The optional `:slot` attaches the diagnostic to that authored hole. Without it,
the span covers the application. Severity is `:error`, `:warning`, or `:info`;
warnings and informational diagnostics remain attached to successful artifacts.

An expression hole can introduce local bindings with `:scope`. Each entry maps
a hole name to a function returning a record of names and quoted types:

```lisp
:types {:where (Expr Bool)}
:scope {:where (fn [holes] {:active (quote Bool)})}
```

Those bindings apply while checking `where`. The ontology query form uses this
to expose the fields of its selected entity. `:type` supplies a constant result
type, or a function computing a type from the holes, independently of the
artifact's IR type.

## Projection and generated consumers

Projection bodies are ordinary pure Forma expressions. They can call helpers,
use local bindings, and branch. Both engines use the same declared contract;
a body that returns the wrong shape produces a diagnostic at elaboration.
Native projection is an optimization of this behavior.

Protocols and schemas derive from `type` declarations. Completion, option
availability, declaration bindings, and form layout derive from the form
pattern and hole types. Add another form by writing another definition;
registration tables and separate payload contracts are unnecessary.

Actions use the same type syntax: `(: hire (-> Candidate (Action (Id Employee))))`.
Their effect bodies use `do!`, `create!`, `update!`, and the other ontology
operations. Generated Effect TypeScript exposes these operations through the
`OntologyRuntime` service, so a host supplies their persistence behavior.
