# RFC 0002: Modules and packages

| | |
| --- | --- |
| Status | Proposed; not implemented |
| Created | 2026-10-06 |
| Scope | Module isolation, imports and exports, compile-time dependencies, package resolution, compilation, and tooling |
| Compatibility | Greenfield design; correctness and a consistent module model take precedence over preserving source-loading behavior |

## Summary

Each Forma file becomes a module with a private scope and an explicit public
interface. Imports bring values, types, macros, and domain forms into that scope
through one mechanism. A dependency graph determines compilation order, and a
linker preserves declaration identity across files and generated targets.

The [unified syntax RFC](./0001-unified-syntax.md) gives individual programs a
consistent language. This proposal gives those programs a project model: reusable
libraries, independently checked modules, packages, and application entry points.
All examples and commands on this page describe proposed behavior.

The examples use the current Effect-value authoring surface.
[RFC 0003](./0003-direct-style-effects.md) proposes direct-style calls, inferred
effects, and deferred functions as an alternative surface for the same module model.

## Current foundations

The Native engine already analyzes `use`, `import`, `export`, and `export-from`
directives in `packages/ocaml/lib/module_decl.ml`. It records dependency metadata,
checks some export references, and tracks public interface changes for cache
invalidation. Namespace imports currently rewrite references to local names;
evaluation still uses shared session bindings.

The TypeScript host loads source bundles into a session without an equivalent
isolated module model. The Effect generator produces individual TypeScript
modules, but does not link imports between Forma files. Protocol manifests also
describe generated imports; those are consumer metadata rather than language
module boundaries.

These mechanisms provide useful foundations. Both engines need the same binding,
visibility, linking, and dependency rules before imports form a complete language
feature.

## Authoring syntax

A file is a module; it needs no enclosing `module` form. Its identity comes from
its package and normalized path within that package.

```text
forma.toml
src/
  orders.forma
  checkout.forma
  main.forma
```

### Definitions and exports

Definitions are private unless exported. Exports can precede their definitions,
as signatures do in the [language reference](../language.md).

```lisp
;; src/orders.forma
(export OrderId Order make-order)

(type OrderId (Brand String))

(type Order
  {:id OrderId
   :total-cents Int
   :status (Union :pending :paid)})

(: valid-total? (-> Int Bool))
(define valid-total? [total] (>= total 0))

(: make-order (-> OrderId Int Order))
(define make-order [id total]
  {:id id :total-cents total :status :pending})
```

`valid-total?` belongs to this module and cannot be imported. The module interface
describes the exported definitions, including their types and any constructors
made public with them. Exporting a name that has no definition is an error.

Ordinary function signatures are optional, including on exported functions. The
compiler derives interfaces from inferred types; an explicit signature constrains
the author's intended API. Service interfaces and form contracts still require
their declared types because those types specify behavior that inference cannot
recover from an ordinary function body.

### Imports

Named imports introduce only the requested exports:

```lisp
;; src/checkout.forma
(import "./orders.forma" [OrderId Order])
(import "@forma/effect" [Effect service do!])

(export Payments pay)

(service Payments
  (: charge (-> OrderId Int (Effect Unit))))

(: pay (-> Order (Effect Order [] [Payments.charge])))
(define pay [order]
  (do! [_ (Payments.charge order.id order.total-cents)]
    {:id order.id
     :total-cents order.total-cents
     :status :paid}))
```

Namespace imports introduce one module alias:

```lisp
;; src/main.forma
(import "./orders.forma" :as orders)
(import "./checkout.forma" :as checkout)

(define example
  (orders/make-order (orders/OrderId "order:1") 1200))

(define main (checkout/pay example))
(export main)
```

`/` qualifies a module export. `.` retains its role for record fields, service
members, and constructor members: `orders/OrderId`, `Payments.charge`, and
`order.id` have distinct meanings. An alias resolves through the module interface,
so `orders/valid-total?` is a visibility error.

Relative specifiers resolve from the importing file. Package specifiers resolve
through the project's dependency configuration. Imports are static and appear at
module top level; they do not depend on runtime values or source-loading order.
The initial grammar offers named and namespace imports. It does not expose the
existing `:all` import mode.

### Re-exports

A module can provide a public entry point for several implementation modules:

```lisp
(export-from "./orders.forma" [OrderId Order make-order])
(export-from "./checkout.forma" [Payments pay])
```

Re-exports retain the original declaration identity. Export name collisions are
errors rather than declarations that silently replace one another.

## Binding and type semantics

Each module has its own lexical scope. Its visible bindings are the small core
language, explicit imports, and its local definitions. Loading a source into a
host session never makes its declarations implicitly visible to other modules.
The exact boundary between core bindings and standard-library imports must be
specified consistently for both engines.

A resolved binding carries an identity derived from the resolved package
instance, module path, and declaration. It is not identified solely by its printed
name. Two modules can declare `Customer`, and their `CustomerId` brands remain
distinct. File contents and source offsets are not nominal identities: ordinary
edits must not create a new type merely by moving its declaration.

An imported definition preserves its generalized type, nominal identity,
constructor information, and Effect capabilities. Generated code may rename an
identifier locally, but must preserve these relationships. A namespace alias is a
compile-time binding; it does not require constructing a runtime dictionary.

Interfaces must also describe constructor visibility and abstraction. A public
type may expose construction or hide its representation, but opaque export syntax
and its schema-generation behavior require a separate decision before that part
of the design is implemented. Public signatures cannot accidentally expose private
implementation details.

The first implementation rejects module cycles and reports the complete import
chain. Recursion inside a module remains supported. Mutually recursive modules
would require explicit interface and initialization rules in a later extension.

## Compile-time modules

Macros and forms are importable library definitions. A domain library can export
a form while keeping its projection helpers private:

```lisp
;; src/greetings.forma
(export greeting)

(type GreetingIR
  {:kind "Greeting" :name Symbol :message String})

(define greeting-message [message] (str "Hello, " message))

(form (greeting name message)
  :types {:name (Declares Greeting) :message String}
  :ir GreetingIR
  {:kind "Greeting" :name name :message (greeting-message message)})
```

```lisp
;; src/home.forma
(import "./greetings.forma" [greeting])

(greeting welcome "Ada")
```

Importing `greeting` carries its pattern, hole types, projection environment,
contracts, and editor metadata. The private `greeting-message` helper remains
available to the library's projection without becoming a consumer binding. The
same rule applies when helpers or contracts belong to another dependency.

Imported macros require hygienic binding identities. A helper referenced by a
library macro resolves in that library; identifiers intentionally supplied by
the caller resolve in the caller's scope. Expansion must preserve both definition
and invocation provenance for diagnostics and editor navigation.

One import syntax covers all declaration kinds. Module interfaces record whether
an export is needed during expansion, checking, elaboration, or execution. The
compiler uses that information to retain compile-time dependencies and avoid
emitting them as runtime imports when they have no runtime role.

## Compiler and host model

Both engines share three conceptual boundaries:

| Concept | Responsibility |
| --- | --- |
| Module graph | Resolve specifiers, discover dependencies, and diagnose cycles |
| Module interface | Describe exported identities, types, constructors, macros, forms, and capabilities |
| Compiled module | Hold checked code, elaboration output, dependencies, and initialization |

Compilation discovers imports, resolves the graph, prepares dependency interfaces
and expansion environments, expands and checks each module, and links the selected
entry point. All passes consume resolved bindings. Imported names must not be
implemented by stripping aliases and looking up names in a shared environment.

The CLI, browser, and embedded hosts supply a resolver. The compiler consumes
resolved source and interfaces; filesystem access, virtual documents, package
downloads, and lockfile handling belong to host adapters. A host session may cache
many modules while retaining their separate scopes.

Generated Effect TypeScript preserves module boundaries with actual imports and
exports. Imported schemas, brands, services, and constructors are emitted once by
their owning modules and referenced by consumers. Other targets may bundle modules,
provided they preserve the same identities and initialization semantics.

Importing a module prepares its definitions and Effect values. It does not execute
an application's effects. A runner invokes an explicit exported entry point with
the required host capabilities. Pure module initialization is deterministic and
occurs once per module instance in a runtime; detailed entry-point and capability
configuration remains an open design item.

## Packages and tooling

A `forma.toml` manifest identifies the package, source roots, dependencies, and
entry points. A lockfile records resolved package versions and integrity data.
Relative imports remain explicit; package imports resolve only through declared
dependencies. Package resolution and type identity must agree when a graph contains
multiple versions of the same package.

The proposed project commands are:

```sh
forma check
forma build --target effect-ts
forma run src/main.forma
forma test
```

These define a project CLI. Runner behavior, test discovery, and
package distribution are part of the project model and are not available today.

The module graph also drives editor navigation, completion, rename, and diagnostics.
Go-to-definition crosses imports and re-exports using resolved identities. Imported
forms supply the same structural editor affordances as local forms. Generated source
maps retain the owning module and original source spans.

Incremental compilation tracks interface and implementation changes separately.
Public type or macro changes invalidate affected consumers. A private runtime body
change normally requires rebuilding its implementation and relinking; a private
helper used by an exported macro or projection also invalidates compile-time
consumers. Dependency fingerprints must include that behavior rather than hashing
only exported names.

## Implementation stages and validation

1. **Isolated modules and linking.** Specify the shared interface format, resolver
   contract, binding identities, named and namespace imports, exports, and cycle
   diagnostics. Implement the same semantics in both engines and generate linked
   Effect TypeScript.
2. **Compile-time libraries.** Carry macro and form environments across imports,
   introduce hygienic expansion, preserve contracts and provenance, and make preludes
   ordinary dependency modules.
3. **Projects and tooling.** Add manifests, lockfiles, package resolution, project
   commands, incremental compilation, and cross-module language services.

Acceptance coverage includes private-name access, duplicate local names across
modules, nominal identity, polymorphic imports, re-export identity, constructor
visibility, cycle diagnostics, and load-order independence. Compile-time fixtures
cover private projection helpers, macro hygiene, transitive dependencies, and
diagnostics at author spans. Integration checks compile and execute linked generated
code and compare both engines' interfaces and artifacts.

Each stage must remove the corresponding dependence on ambient session bindings.
The initial implementation should not retain a compatibility mode that exposes
other loaded files implicitly.

## Decisions still required

- The exact implicit core and the public standard-library module layout.
- Opaque type exports, constructor visibility, and deriving codecs for opaque types.
- Import renaming and any later support for recursive modules.
- Typeclass instance export and coherence rules across modules.
- Package registry or repository distribution, manifest fields, and lockfile format.
- Entry-point signatures, host capability provisioning, and test discovery.
- Stable domain and wire names when separate modules declare the same local name.

These decisions refine the module boundary; they should be settled explicitly
before their syntax or runtime behavior is implemented.
