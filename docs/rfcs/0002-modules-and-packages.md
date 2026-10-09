# RFC 0002: Modules and packages

| | |
| --- | --- |
| Status | Stage 1 implemented; stage 2 file-based slice implemented; later stages proposed |
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
Relative file imports, explicit exports, re-exports, isolated scopes, and linked
Effect TypeScript are implemented in stage 1; see [working file modules](../modules.md).
Relative compile-time library imports and host-selected project preludes are
implemented in the TypeScript and Native OCaml engines. Package paths and project
commands remain proposed.

The examples use the current Effect-value authoring surface.
[RFC 0003](./0003-direct-style-effects.md) proposes direct-style calls, inferred
effects, and deferred functions as an alternative surface for the same module model.

## Foundations before stage 1

The Native engine already analyzes `use`, `import`, `export`, and `export-from`
directives in `packages/ocaml/lib/module_decl.ml`. It records dependency metadata,
checks some export references, and tracks public interface changes for cache
invalidation. Before stage 1, namespace imports rewrote references to local names and
evaluation used shared session bindings. Stage 1 removes both behaviors.

Previously, the TypeScript host loaded source bundles without isolated scopes,
and the Effect generator emitted individual files without linking them. Protocol manifests also
describe generated imports; those are consumer metadata rather than language
module boundaries.

The new module graph, interface, checking, runtime, and linking APIs share
binding and visibility rules across both engines. The older artifact module
metadata remains consumer metadata; it does not resolve executable module imports.

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
language, explicit imports, project prelude exports in stage 2, and its local
definitions. Loading a source into a host session never makes its declarations
implicitly visible to other modules. The stage 1 and stage 2 core
boundaries below apply consistently to both engines.

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

## Stage 1 decisions

Stage 1 implements relative file modules. Package resolution, compile-time library
imports, opaque types, typeclass coherence, and project commands remain proposals.
The resolver contract is `(specifier, importerId) -> {id, source} | missing`.
The host supplies canonical file-instance IDs and source text. The compiler never
reads the filesystem. In-memory bundles and Node file adapters use normalized
paths; identity consists of the file-instance ID and declaration name, independent
of contents, offsets, session IDs, or graph traversal order. Hosts resolving different
package instances must supply different IDs in a later package implementation.

Stage 1’s initial implicit core was the kernel builtins and bundled kernel prelude,
primitive/container type constructors, and the current `type`, `class`, `error`,
`service`, `layer`, and Effect-value authoring forms (including `do!`). Host-loaded
preludes are compiler configuration, applied consistently to each isolated file;
ordinary loaded sources never become preludes. Making these preludes ordinary
explicit libraries belongs to stage 2. `use` does not import file declarations.

Types are transparent in stage 1. Exporting a type exports its representation and
owned constructors; consumers use `Type.Constructor` or `alias/Type.Constructor`.
Importing a type does not introduce bare constructor names. Brand, class, and error
construction uses the type name itself. Local tagged constructors may use bare
names when unambiguous. Services expose members through the exported service name.
Constructor names cannot be exported independently. Re-exports preserve the original
owner and never manufacture another type or constructor. Opaque export syntax and
codecs are deferred. A public signature must not expose a private nominal type;
export the type as part of the same public interface.

Module interfaces record `moduleId` and sorted exports with `name`, `kind`,
`identity: {moduleId, declaration}`, the internal resolved `symbol`, and owned
`constructors`. Checking adds portable generalized `scheme: {parameters, type}`
syntax; imported schemes are
instantiated at each use. Internal symbols encode both the module ID and declaration
name injectively, including names that normalize alike in a target language, and
preserve declaration capitalization. These symbols are compiler-owned and cannot
be spelled in authored code. Namespace aliases exist only during resolution.

Named imports may be re-exported with `export`; `export-from` introduces no local
binding. Duplicate local/import names, namespace aliases, and public export names
are errors, even if both occurrences refer to the same declaration. There is no
`:all` mode or import renaming. Cycles are rejected with the complete entry-to-cycle
chain at the closing import. Modules initialize in dependency order once per runtime
instance; source changes create a new instance. Kernel evaluation initializes pure
definitions and runs only the selected entry file's application expressions. Linked
Effect TypeScript initializes pure values, functions, and lazy Effect values; running
an Effect requires an explicit runner. Kernel evaluation rejects Effect programs
with `module/effect-runtime`; it does not emulate the Effect runtime.

The existing domain artifact APIs maintain a separate reference index of
declaration data, type metadata, and global seed IDs. Their symbolic references
are data references, not executable imports. This index never publishes source
functions or bindings into module scopes; its cache tracks data dependencies
separately. Form-library imports and linking those projections belong to stage 2.
Stage 1 rejected imported macros and forms. Stage 2 links them through their
defining module; typeclass instance imports and coherence remain deferred.

## Stage 2 decisions

These decisions define the agreed stage 2 direction. The file-based slice now
implements imported forms and macros, project preludes, declaration descriptors,
pure collections, public schemas, and portable data facets in both the TypeScript
and Native OCaml engines. The shared Stripe → Salesforce fixtures pin this slice.
Data-member provenance currently conservatively retains every contributing input
declaration through arbitrary pure helpers; it does not identify the minimal
input set or a distinct authored span for each computed field. Module interfaces
are rebuilt on demand, so helper and input changes refresh derived data without
a persistent compile-time cache. Migrating the legacy artifact emit pipelines
and bundled domain stacks, richer schema field spans, complete macro hygiene
for every binding construct, related-location diagnostics, and a persistent
compile-time cache remain follow-up work. The remaining requirements below
describe the target design, not additional shipped guarantees.

Stage 2 makes preludes ordinary dependency modules and extends interfaces with
compile-time definitions, declarations, schemas, and pure data. It retains the
current Effect-value surface. Package resolution, manifests, lockfiles,
`interface`/`implements`, rename tracking, registry publishing, and RFC 0003
direct-style effects remain outside this stage. Typeclass instance imports and
coherence still require a separate decision.

The implicit core is the kernel's intrinsic syntax and evaluation primitives,
primitive/container and Effect type constructors, and the intrinsic declaration
forms `type`, `class`, `error`, `service`, `layer`, and `do!`. It includes `define`,
signatures, lexical binding and control primitives, `macro`, `form`, and the
`Declares` and `Refers` contract machinery needed to author libraries. This is a
fixed language boundary shared by both engines; it contains no bundled source
prelude, domain forms, descriptor stack, or host-loaded bindings. Kernel sugar
such as `when`, `cond`, and threading macros moves into ordinary exported
libraries. The six stage-1 declaration and Effect forms stay intrinsic in this
stage; library imports do not activate or replace their semantics. An eventual
`@forma/effect` library exports helpers around this core rather than supplying
`service`, `layer`, or `do!` bindings. This boundary retains the built-in forms agreed for this stage.

A project-level `"prelude"` setting selects one module specifier. The host passes
that setting, the project's canonical resolution base, and source ownership to
the compiler; stage 2 does not introduce a manifest format. An omitted setting
means no automatic library imports. The selected module's public exports are
imported into each source module owned by that project, as if named imports had
listed those exports. A prelude replaces only the project's automatic library
imports, never the intrinsic core. A project can compose a prelude with ordinary
`export-from` declarations. There is no `:all` source syntax and no ambient stack
of loaded preludes.

The prelude resolves through the same host resolver and has the same identities,
visibility, collisions, and cycle rules as an explicit dependency. Relative
prelude specifiers resolve from the project's supplied base, not separately from
each source file. Missing modules and conflicts report the setting's source span
when supplied, or a project configuration diagnostic. Automatic imports collide
with local definitions and explicit imports just as named imports do, even when
they name the same identity. Prelude modules and their dependency closure must
bootstrap through intrinsic syntax and explicit imports; they do not receive
their own project's automatic prelude. Dependency libraries use their owning
project's configuration, never the importing project's selection. Salesforce
and Stripe libraries can therefore coexist in one graph without sharing scopes.
Hosts must assign each module one owning project; changing a project's prelude
does not reinterpret another project's modules.

An imported form carries its pattern, hole types, `:check`s, `:scope`, projection,
result and IR contracts, emit hooks, documentation, examples, and editor metadata.
Its interface identifies the defining module and the resolved dependencies needed
by these operations. Private helpers and private contract/schema support remain
in that module's compile-time environment. Their retention does not export their
names. Public runtime signatures still obey stage 1's private nominal type rule.
The consumer supplies the authored holes and a semantic view of its own visible
declarations; it does not supply the lexical environment for library helpers.

Compilation links an immutable compile-time environment per defining module,
containing intrinsic primitives, that module's explicit imports, and its private
definitions. Form operations and macro expansion retain a reference to that
environment by module and binding identity. Dependencies of helpers are linked
transitively through their own interfaces. No concatenated helper source, copied
caller bindings, or session-wide environment substitutes for these links. Library
identifiers in macro expansions resolve at the definition; caller syntax retains
caller bindings; introduced identifiers are fresh. Re-exporting a form or macro
retains its original environment and identity. Expansion records both definition
and invocation spans.

Export discovery follows resolved form contracts. At module top level, each
symbol-valued `(Declares T)` hole introduces a declaration in the invoking
module, not the form library. The interface identity remains
`{moduleId, declaration}`; `declaration` is the introduced name, independent of
form name, payload kind strings, source offsets, and expansion order. The compiler
must not maintain a list of domain heads such as `price` or `profile` to discover
these exports. Multiple declaring holes introduce separate identities; forms
without declaring holes introduce none. Scoped child declarations do not become
module exports. `(Declares T String)` introduces a data identity, not a lexical
symbol; its data can be exposed through an explicitly exported collection.
Existing duplicate-name, private-name, and undefined-export rules apply, and an
`export` may precede the declaring form invocation.

The graph first resolves dependency forms and expands macros, then discovers
local declarations and prepares their identities before checks and projections.
Declaring names must be obtainable from authored or expanded syntax and the form
pattern, without evaluating a projection. Expansion cannot add computed imports
or otherwise change the static dependency graph. Pure data dependencies within a
module are evaluated in dependency order; forward declaration references are
allowed, but cyclic demands for data are diagnosed with their reference chain.
Module cycles remain rejected. Macro-introduced private names remain hygienic;
public declarations require a stable name supplied by the caller.

Interfaces extend the existing binding entry with phase availability and optional
compile-time facets. Both engines expose the same portable information:

| Facet | Contents |
| --- | --- |
| Binding | Public name, owning identity, resolved symbol, kind, constructors, and runtime `scheme` when applicable |
| Declaration | Kind `declaration`, classification from the resolved `T` in `(Declares T)`, declaring form identity, and authored declaration span |
| Schema | Resolved structural/type metadata, field metadata and spans, and the identities of referenced types or declarations |
| Data | Immutable pure value, compile-time `scheme`, payload contract when applicable, and provenance for its members |
| Form or macro | Definition metadata, contracts, linked environment reference, and definition/expansion provenance |

Classification, payload type, and runtime type are separate. A `price` form may
declare `PriceDecl` while projecting a record checked against `PriceIR`; neither
automatically creates a runtime constructor or value. The declaration's data
facet contains the checked projection and its contract. A runtime `scheme` is
attached only if the form also introduces a checked runtime binding; no runtime
scheme is invented from the classification or payload kind. The data facet's
compile-time `scheme` describes the descriptor, including its classification and
payload type, or the inferred type of an ordinary pure value. Imported schemes
are instantiated at each use in their applicable phase. Exported types carry
schema metadata alongside their existing schemes and constructors, so importing
`Account` is sufficient to inspect its public schema during field checks and
mappings. Private schema support carried by a contract is inspectable only through
that contract, not as additional named declarations.

An imported declaration resolves to its original identity in declaration holes
and to an immutable declaration descriptor during pure elaboration. Library
operations can inspect its classification, schema, and checked data. A pure
`define` can build an exported value such as `prices` from these descriptors and
ordinary literals. Its data facet is available to consumers in addition to its
inferred scheme. The portable representation preserves symbols, keywords, type
references, and declaration references explicitly; printed names or lossy JSON
strings must not replace identities. Functions can be linked for pure elaboration
but are not serialized as data. Effects, host handles, mutable state, and closures
are not inspectable data payloads. A consumer demanding a value that cannot be
prepared purely receives a diagnostic at that demand.

For a typed data hole, a form may accept an expression such as `billing/prices`;
it checks that expression in the caller's scope and evaluates it purely before
projection. `Declares` and `Refers` holes retain declaration/reference syntax and
resolve identities; `Syntax` holes retain syntax, and executable expression holes
retain code for their declared phase. The projection's linked lexical environment
receives the resulting hole values without inheriting the caller's bindings.

Thus `sales/SalesUser` identifies an exported profile declaration,
`billing/prices` exposes an inspectable collection to `picklist-of`, and
`sales/Account` exposes only its public schema. Named imports, namespace imports,
and re-exports carry these facets under the existing visibility rules. Private
declarations do not become independently discoverable merely because their data
appears inside an exported value. An exported value may intentionally include
checked data and opaque references to them; this grants no private name lookup.
Compile-time access creates no runtime import when the binding has no runtime
role.

The artifact declaration-data index is a projection of these resolved identities
and facets, not a second module namespace. Module elaboration can query local
declarations and imported public facets, plus private support accessible within
the defining library's environment. It cannot scan sibling files, all loaded
sources, or global seed IDs to bypass an import. Standalone artifact consumers may
retain their explicit data-index API, but it never publishes bindings into module
scopes. Reference checks compare identity and classification rather than matching
printed names or looking up the producer's form in the caller's registry.

Pure elaboration may construct syntax or IR describing future platform behavior,
including `(update! ...)` inside a deferred action body. It must not execute that
operation. The same operation in an invoked executable action remains an Effect
and runs only through an explicit runner with its host capabilities. Phase
availability and the hole's contract distinguish inspectable data or syntax from
executable code; neither imports nor pure projection helpers turn an Effect into
compile-time data. Constructing an Effect value does not run it and does not make
its result available during elaboration. Stage 2 introduces no direct-style effect
inference or implicit execution.

Provenance accompanies data independently of its payload. Each exported
declaration and payload member retains its defining module, identity, and authored
span. Selection and reordering preserve member origins; a derived value records
the transformation's authored span and its input origins, even when a computation
combines several inputs. Collection elements and record fields must retain this
information so a derived picklist entry can be traced to its Stripe price.
Diagnostics for a broken authored reference point to that reference's exact span;
diagnostics for derived data use the consumer's transformation or use span and
include the defining data spans as related locations. Generated or library spans
must not replace available authored spans. Re-exports preserve provenance.

Cache dependencies distinguish runtime implementation, public type/interface,
and compile-time behavior/data. A compile-time fingerprint includes form or macro
definitions, contracts, reachable private helpers and their transitive imports,
exported schema metadata, and evaluated data actually consumed during elaboration.
Each compile-time read records its owning identity and facet; implementations may
invalidate at whole-module granularity initially but must include all these
dependencies. Changing a price amount, an `Account` field, or a private projection
helper invalidates affected elaborations even when exported names and schemes
stay unchanged. Prelude selection and resolved automatic imports are also cache
inputs. Provenance is refreshed when source spans move, independently of nominal
identity and semantic data equality. Cached data must never lose its origins.

Acceptance starts with a TypeScript vertical slice using relative modules: import
a Stripe form library with a private helper, export two price declarations and a
pure `prices` collection, then derive a Salesforce picklist from that collection.
A broken imported reference must report its authored span. Conformance fixtures
also cover classification mismatches, schema inspection, private helper isolation,
re-export identity, macro hygiene, distinct project preludes, data/helper cache
invalidation, derived provenance, and deferred `update!` without execution. The
OCaml implementation follows with the same normalized interfaces, data, and
diagnostic expectations; parity is established by running those fixtures.

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

- The public standard-library module layout beyond the file-based kernel library.
- Opaque type exports, constructor visibility, and deriving codecs for opaque types.
- Import renaming and any later support for recursive modules.
- Typeclass instance export and coherence rules across modules.
- Package registry or repository distribution, manifest fields, and lockfile format.
- Entry-point signatures, host capability provisioning, and test discovery.
- Stable domain and wire names when separate modules declare the same local name.

These decisions refine the module boundary; they should be settled explicitly
before their syntax or runtime behavior is implemented.
