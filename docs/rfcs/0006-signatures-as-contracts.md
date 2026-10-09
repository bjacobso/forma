# RFC 0006: Signatures as contracts

| | |
| --- | --- |
| Status | Proposed; not implemented |
| Created | 2026-10-09 |
| Scope | JSON Schema derived from Forma types, documentation on signatures, type-directed JSON decoding, export descriptions through the host |
| Direction | The portable module interface is the source of truth; JSON Schema is a derived view with explicit unsupported cases |

## Summary

A host can ask for the exports of a module and receive, for each one, its name,
kind, documentation, type, and a JSON Schema for its parameters and result.
Signatures gain a `:doc` option. The host can also decode JSON arguments
against a binding's parameter type and report mismatches by path. The schema
is derived from the portable module interface, so it does not depend on which
engine checked the module.

## Motivation

Forma types are already schemas ([language guide](../language.md#types-are-schemas)).
Many systems that call into a Forma program describe their inputs with JSON
Schema: model tool calling and structured output, HTTP descriptions, form
generators, and protocol servers. Today a host that exposes a Forma function
to such a system must restate its contract by hand.

The prompting case is a coding agent built on Forma
([RFC 0005](./0005-live-sessions.md) describes the evaluation). In oh-my-lisp,
a tool is a documented public function; its parameter schema comes from the
function's argument destructuring plus optional annotations, and its docstring
is the description the model reads. In Forma the declared type carries more
information than destructuring does: required and optional fields, literal
unions, brands, and nested records. The tool contract should come from that
type. The mechanism is general and contains no agent concepts.

## Current state

- **Portable interfaces.** `host.moduleGraph` returns `ModuleInterface`
  values (`packages/ts/src/modules/graph.ts`). Each export has a name, a
  binding identity, a declaration kind, constructors, and an optional
  `scheme` of quantified parameters and type syntax as JSON. For `type`,
  `class`, `error`, and `service` declarations the scheme holds the
  declaration body (`packages/ts/src/modules/check.ts`). The native OCaml
  host returns the same type from its `moduleGraph` operation; the two
  engines' schemes are not yet compared by a fixture. Interfaces carry no
  documentation or source spans.
- **JSON Schema.** The only emitter is `editScriptJsonSchema()`
  (`packages/ts/src/editor/edit-script.ts`), which describes edit scripts,
  not Forma types.
- **Effect Schema.** The Effect TypeScript generator
  (`packages/ts/src/mechanics/effect-typescript.ts`) emits `Schema` values for
  declarations; the mapping is in the [Effect reference](../effect/reference.md).
  Effect can derive JSON Schema from those values, but only after the
  generated module is compiled and loaded.
- **Runtime validators.** The `schema/*` builtins and `assert-valid`
  (`packages/ts/src/builtins/schema.ts`) validate values against schema maps
  built at runtime. They are not connected to declared types.
- **Documentation.** Type and field metadata accept `:doc` and `:title`
  (`packages/ts/src/surface/type-syntax.ts`, `splitTypeMetadata` in
  `packages/ts/src/surface/domain.ts`); `meta` and `type/metadata` read it at
  runtime (`packages/ts/src/builtins/meta.ts`). Descriptors, slots, and meta
  functions accept `:doc` (`packages/ts/src/descriptor/parse-descriptor.ts`,
  `meta-fn-decl.ts`), and the editor shows slot documentation
  (`packages/ts/src/editor/slots.ts`). `define` and `:` have no documentation:
  `(define name value)` takes exactly two arguments, and in
  `(define name [params] body...)` everything after the parameters is body.
- **Host values.** The `plain-json` projection
  (`packages/host/src/value-projections.ts`) converts results to JSON without
  type information; keywords become strings. Arguments enter as
  `ValueProjection` values. There is no type-directed decoding from JSON.
- **Host builtins.** `HostBuiltinDescriptor.typeScheme`
  (`packages/host/src/types.ts`) uses `TypeSchemeExpr`, which has named
  types, functions, lists, maps, and `any`, but no records, unions, or
  options.

## Proposal

### Documentation on signatures

A signature accepts metadata after its type, in the same position as type and
declaration metadata elsewhere:

```lisp
(: word-count
   (-> {:path (String :doc "File path")
        :limit (Option Int :doc "Stop counting here")}
       Int)
   :doc "Count the words in a text file.")
(define word-count [{:path path :limit limit}] ...)
```

`:doc` and `:title` are the initial keys. Field documentation uses the
existing field metadata. A definition without a signature has no
documentation; its inferred scheme is still exported. The interface entry for
a binding gains optional `doc`, `title`, and `span` fields.

### JSON Schema mapping

The emitter targets JSON Schema 2020-12. It describes the JSON form that the
host decodes into Forma values and encodes from them. That form follows the
existing Effect Schema mapping: record keys without the leading colon,
keyword literals as strings, absent optional fields omitted.

| Forma type | JSON Schema |
| --- | --- |
| `Unit` | `{"type":"null"}` |
| `Bool`, `Int`, `Number`, `String` | `boolean`, `integer`, `number`, `string` |
| `Keyword` | `string` |
| literal `:a`, `"a"`, `1`, `true` | `{"const": ...}`; keywords as strings |
| `(Union :a :b)` (all literals) | `{"enum": [...]}` |
| `(Union A B)` | `{"anyOf": [A, B]}` |
| `(Brand T)` | schema of `T`, with `title` set to the brand name |
| `{:a A :b (Option B)}` | `object`, `properties`, `required` for non-`Option` fields, `additionalProperties: false` |
| `{:a A & row}` | as above with `additionalProperties: true` |
| `(List T)` | `{"type":"array","items":T}` |
| `(Tuple A B)` | `prefixItems`, `minItems` and `maxItems` 2, `items: false` |
| `(Map String V)` | `{"type":"object","additionalProperties":V}` |
| `(Map (Union :a :b) V)` | `properties` for each key, none required, `additionalProperties: false` |
| `(Tagged (C1 {...}) (C2 T) C3)` | `oneOf` of objects with a `const` discriminator (`_tag`, or the `:tag` field), record payload fields merged, scalar payload under `value` |
| `class`, `error` | object schema of the fields; errors include their `_tag` constant; `title` is the declared name |
| named type reference | `$ref` into `$defs`, keyed by binding identity; recursive types use the same reference |
| `Json` | `{}` |
| `Never` | `false` |
| metadata `:doc`, `:title`, `:pattern`, `:default`, `:format`, `:min`, `:max`, `:min-length`, `:max-length` | `description`, `title`, `pattern`, `default`, `format`, `minimum`, `maximum`, `minLength`, `maxLength` |

The following have no schema. The emitter reports a diagnostic naming the
type and its source span instead of approximating:

- function types, `Effect`, `Stream`, `Fiber`, `Layer`, `Ref`, `RefCell`,
  `Scope`, and syntax types (`Symbol`, `Syntax`, `RuntimeExpr`, `Type`);
- `Any` and `Unknown`, which would accept every value without checking;
- `(Option T)` outside a record field, and `Result`, until each has a defined
  JSON encoding;
- `Bytes`, `DateTime`, and `Duration`, until each has a declared codec;
- schemes with free type variables. A host can instantiate them explicitly.

Brands and classes lose their nominal identity in JSON Schema. Decoding
restores it, because decoding follows the Forma type, not the schema.
JSON Schema 2020-12 has no discriminator keyword; tagged unions rely on the
`const` discriminator in each branch.

### Contracts for bindings

For a value export, the contract is the schema of its type. For a function:

- one record parameter: `parameters` is that record's object schema;
- no parameters: `parameters` is an empty object schema;
- otherwise: `positional` lists one schema per parameter.

`result` is the schema of the return type. For an Effect signature, `result`
describes the success type, `throws` lists the error schemas, and `requires`
lists the requirement names. A host that only supports object parameters can
require the one-record convention.

```ts
interface BindingContract {
  readonly name: string;
  readonly identity: BindingIdentity;
  readonly kind: ModuleDeclarationKind;
  readonly doc?: string;
  readonly title?: string;
  readonly span?: Span;
  readonly type: string;                 // display form
  readonly scheme?: ModuleTypeScheme;
  readonly parameters?: JsonSchema;
  readonly positional?: readonly JsonSchema[];
  readonly result?: JsonSchema;
  readonly throws?: readonly JsonSchema[];
  readonly requires?: readonly string[];
  readonly diagnostics: readonly Diagnostic[];  // parts without a schema
}
```

For the signature above, `parameters` is
`{"type":"object","properties":{"path":{"type":"string","description":"File path"},"limit":{"type":"integer","description":"Stop counting here"}},"required":["path"],"additionalProperties":false}`.

### Host operations

- `describeExports({ sessionId, sourceId, names? })` returns the entry,
  one `BindingContract` per export, shared `$defs`, and diagnostics.
- `decodeArguments({ sessionId, sourceId, name, json })` decodes JSON
  against the binding's parameter types. Failures are diagnostics with a
  JSON path and the expected and actual shapes in `details`, for example
  `parameters.limit: expected integer, got string`. `callBinding`
  ([RFC 0005](./0005-live-sessions.md)) accepts the same `json` form.
- The mapping is a pure library function in `@formalang/ts`, applied to
  `ModuleInterface` values. Hosts for either engine use the same function, so
  the OCaml engine needs no separate emitter.

## Alternatives considered

- **Derive JSON Schema from generated Effect Schema.** Effect already
  converts Schema values to JSON Schema. This requires compiling and loading
  generated TypeScript at runtime, only covers programs that the Effect
  generator accepts, and makes the contract depend on one target's
  annotations. It remains a useful cross-check in tests.
- **A prelude-defined emitter.** Prelude forms can define emitters, as
  `preludes/http-api.lisp` does. The mapping here covers core type
  constructors (`Option`, `Tagged`, `Brand`) rather than domain vocabulary,
  and it must read resolved interfaces. Preludes can still build on the
  contracts, for example to emit a domain-specific tool manifest.
- **Docstrings in `define`.** `(define name "doc" value)` resembles
  `(define greeting "Hello")`, and in the function sugar a string after the
  parameters is a valid body. Placing documentation on the signature avoids
  both ambiguities and keeps contracts in one form.
- **Extend `TypeSchemeExpr`.** Host builtin descriptors could adopt Forma type
  syntax instead. That is a separate change to host builtin typing; this RFC
  only reads module interfaces.

## Implementation stages and validation

1. **Signature metadata.** Parse `:doc` and `:title` on `:` in both engines;
   carry `doc`, `title`, and `span` in `ModuleBinding`. Fixtures in
   `conformance/modules/` check that interface output includes them and that
   unknown keys are rejected at their spans.
2. **Mapping.** Implement the table above. Golden fixtures in a new
   `conformance/json-schema/` directory map one declaration per case to its
   expected schema or diagnostic. A test validates every golden schema with
   a JSON Schema 2020-12 validator, and validates sample values encoded by
   the host against it. For declarations the Effect generator supports, a
   test compares against Effect's derived JSON Schema and records intended
   differences.
3. **Host operations.** `describeExports` and `decodeArguments` in the
   TypeScript host. Tests decode valid and invalid arguments and check
   diagnostic paths; a round trip of encode, validate, and decode preserves
   values for every supported case.
4. **Engine comparison.** The parity runner compares both engines'
   `moduleGraph` schemes for the fixture modules, so the shared mapping
   produces the same contracts from either engine.

## Decisions still required

- JSON encodings for `Option` outside records, `Result`, `Bytes`,
  `DateTime`, and `Duration`.
- Whether to offer profiles for model providers that accept only a subset of
  JSON Schema, such as requiring every property and expressing optional
  fields as nullable. This RFC emits standard 2020-12 and reports constructs
  a profile would reject.
- Whether multi-parameter functions should use parameter names from the
  definition as object properties.
- How explicit type arguments are supplied for polymorphic bindings.
