# RFC 0022: Generating schemas and types from `type` declarations

| | |
| --- | --- |
| Status | Proposed; not implemented. Amends [RFC 0011](./0011-signatures-as-contracts.md) |
| Created | 2026-11-04 |
| Depends on | RFC 0011's JSON Schema mapping, which this RFC shares and extends |
| Scope | One supported build step from Forma `type` declarations to Effect Schema, plain TypeScript types, JSON Schema 2020-12 and a Markdown reference, with a freshness check |
| Direction | One mapping from normalized types to a wire encoding, printed by several targets; fail closed with located diagnostics |

## Summary

`forma schema <entry.forma> --out <dir>` reads the `type` declarations of a
module and its imports, maps them once to the JSON encoding that Forma
artifacts use, and writes:

- `schema.ts`, with Effect Schema codecs;
- `types.ts`, with plain TypeScript types and no runtime imports;
- `schema.json`, a JSON Schema 2020-12 document;
- optionally, a Markdown reference page.

`--check` regenerates in memory and fails if a file differs, naming the
command that updates it. A type without a defined encoding is an error at
its span; the generator never emits `Unknown`.

Most of the Effect Schema mapping already exists on main. This RFC makes it
a supported build step, closes the gaps worldvm hit, and adds the JSON
Schema printer that RFC 0011 specifies.

## Motivation

worldvm defines its canonical world IR as 569 lines of Forma `type`
aliases (`packages/world-ir/ir.lisp`). `packages/forma/scripts/generate-ir.mjs`
(183 lines) and `ir-external.mjs` (109 lines) generate Effect Schema, plain
TypeScript types, JSON Schema 2020-12 and a reference page from those
aliases. The package's `build` and `typecheck` scripts run the generator
with `--check`, so CI fails when a generated file is stale.

The script calls `lowerProgram` from `@formalang/ts/type` and walks the
internal `TypeDef` and `TypeExpr` trees (`TERow`, `TESym`, `TEApp`) by their
`_tag` fields. Its decisions record why it did not use Forma's generator: the
vendored `generateEffectSchemaModule` "maps only scalar
String/Int/Bool/Symbol and otherwise emits Unknown". That function is the
descriptor generator in `descriptor/descriptor-to-schema.ts`, not the
mechanics generator.

What the script needed:

| Need | worldvm's choice |
| --- | --- |
| An `(Option T)` record field | An optional key, never `null` |
| `Unit` | `null` |
| Keyword literals | Strings without the colon |
| `Int` | `Schema.Int`; JSON Schema `integer` bounded to ±(2^53 − 1) |
| Recursive and forward references | `Schema.suspend`, typed with the generated TypeScript type |
| Non-empty lists | `Schema.NonEmptyArray`; `readonly [T, ...T[]]` |
| Range, pattern and date constraints | Its own `(Refined Int {...})` vocabulary |
| Brands | Erased to the underlying schema |
| Open rows, `Map`, generic aliases, other constructors | Rejected, never `Unknown` |
| Plain TypeScript types | A separate file with no `effect` import |
| Documentation | Source text sliced by span into a reference page |
| Freshness | `--check`, byte comparison, wired into build and CI |

## Current state

Main has four schema emitters and no supported command:

- **`Mechanics.generateEffectProgram`** accepts plain `type` declarations
  as an Effect program. A probe on main generated a recursive record with
  an `(Option String)` field and an `(Int :min 0)` field:

  ```ts
  export type Node = { readonly label: string; readonly note?: string;
    readonly children: ReadonlyArray<Node>; readonly n: number; readonly u: void; ... };
  export const Node: Schema.Codec<Node> = Schema.Struct({
    label: Schema.String,
    note: Schema.optionalKey(Schema.String),
    children: Schema.Array(Schema.suspend((): Schema.Codec<Node> => Node)),
    n: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
    u: Schema.Void, ... });
  ```

  Literal unions, `Tagged`, `Map`, `Brand` and refinements map as well. This
  covers most of worldvm's table, and it is in the 0.3.0 tarball worldvm
  vendors. It is documented as Effect program generation, not as a schema
  build step.
- **`Mechanics.generateMechanicsEffectSchemaModule`**
  (`mechanics/effect-schema.ts`) prints only the schemas. It orders
  declarations but never uses `recursiveSchemaNames`. For a recursive type
  it emits `NodeSchema = Schema.Struct({ children: Schema.Array(NodeSchema) })`,
  which throws `ReferenceError: Cannot access 'NodeSchema' before
  initialization` when the module loads.
- **`descriptor-codegen`'s `generateEffectSchemaModule`** generates schemas
  for descriptor trees. This is the scalar-only generator worldvm found.
- **`protocol-effect-schema.ts`** emits protocol descriptor modules.

Gaps against worldvm's needs, all checked on main:

- A generic alias such as `(type (Box a) {:value a})` fails with
  `artifact/schema: type expects a schema name`.
- Recursion through a brand fails with `mechanics/recursive-schema`.
- `Unit` maps to `Schema.Void` and `void`. The artifact encoding of `Unit`
  is `null`.
- There is no JSON Schema output. RFC 0011 specifies the mapping for module
  interfaces, but no implementation exists.
- There is no TypeScript output without an `effect` import.
- `:doc` metadata becomes an Effect `description` annotation, but no
  reference page is generated.
- Type declarations have no stable public reflection API. worldvm depends on
  `lowerProgram`'s internal trees.

## Proposal

### One mapping, several printers

The generator normalizes each declaration's type (RFC 0007, or local
reduction of `Pick`, `Omit` and `Merge` until that service exists) and maps
it to a target-neutral **wire schema** node. Effect Schema, TypeScript, JSON
Schema and Markdown are printers over those nodes. The existing mechanics
`SchemaDef` node (`Struct`, `Optional`, `Array`, `Ref`, `Brand`, `Literal`,
`Union`, `TaggedUnion`, `Annotated`, ...) is the starting point, so the
Effect printer is the mechanics printer.

The mapping is RFC 0011's table, with these amendments and decisions:

| Forma | Wire encoding | Effect Schema | TypeScript |
| --- | --- | --- | --- |
| `Unit` | `null` | `Schema.Null` | `null` |
| `(Option T)` field | key omitted when absent | `Schema.optionalKey(T)` | `k?: T` |
| `(Option T)` elsewhere | none; error | | |
| `Int` | JSON integer within ±(2^53 − 1) | `Schema.Int` | `number` |
| `Float` | finite JSON number | `Schema.Number.check(Schema.isFinite())` | `number` |
| `(List T :min-length 1)` | array, `minItems: 1` | `Schema.NonEmptyArray(T)` | `readonly [T, ...T[]]` |
| `(String :format "date")` | string, `format: "date"` | pattern and calendar check | `string` |
| `(Brand T)` | as `T` | `T.pipe(Schema.brand(name))` | branded type |
| recursive or forward reference | `$ref` | `Schema.suspend(() => X)`, typed `Schema.Codec<T.X>` | the name |
| generic alias | none until instantiated | | |

Notes:

- **`Unit` changes meaning in generated Effect code.** `Unit` remains
  `Schema.Void` inside Effect programs, where it is the result of an
  operation. Schema generation for data uses `Schema.Null`. The generator
  states which encoding it targets, and only the data encoding is
  supported.
- **Refinements use Forma's existing metadata** (`(Int :min 0 :max 10)`,
  `(String :pattern ...)`, `:min-length`, `:max-length`, `:finite`),
  plus `:format "date"` and `:exclusive-min`. worldvm's `Refined`
  vocabulary migrates to them.
- **Brands are nominal by default,** because Forma brands are nominal.
  A `--structural-brands` option erases them, as worldvm does.
- **Generic aliases** are generated only where a declaration instantiates
  them, under a name derived from the arguments, or under a name the
  author gives (`(type BoxInt (Box Int))`).
- **Unsupported constructors** report `schema/unsupported` at the type's
  span, with RFC 0011's list: functions, effects, syntax types, `Any`,
  `Unknown`, and `Option` outside a record field.
- **Open rows** follow RFC 0011: `{:a A & row}` maps to an object with
  `additionalProperties: true`, and Effect Schema keeps unknown keys. A
  `--closed` option rejects open rows instead, which is worldvm's choice for
  canonical IR.

### Outputs

- `types.ts`: every declaration as a TypeScript type, no imports.
- `schema.ts`: `export const X: Schema.Codec<T.X> = ...` for each
  declaration, importing `types.ts` as `T`. Typing each codec against its
  plain type makes `tsc` check that the two outputs agree, which is
  worldvm's technique.
- `schema.json`: `$defs` keyed by declaration name, with an optional
  `--root` producing `$ref` at the top level and an `--id` URN.
- `reference.md`: one section per declaration, with its `:doc`, its source
  as written, and links between declarations. The site's generated prelude
  reference pages use the same renderer.

Output is deterministic. Declarations appear in dependency order, then in
source order. Each file starts with a header naming the entry module and the
command that regenerates it.

### The build step

- **Library.** `generateTypeSchemas({ module, roots?, targets, options })` in
  `@formalang/ts`, applied to a module interface. This is the same input as
  RFC 0011's `describeExports`, so a host contract and a generated schema
  never disagree.
- **Command.** `forma schema <entry.forma> --out <dir> [--targets ...]
  [--check]` in the host CLI, next to `file typecheck` and `file interface`.
- **Freshness.** `--check` regenerates in memory, compares bytes, and lists
  stale, missing and extra files. A consumer runs it from its test or build
  script, as worldvm does. Generated files are not formatted by a separate
  tool, so the check does not depend on a formatter version.
- **Reflection.** A public `TypeDeclaration` view (name, parameters,
  normalized type, metadata, doc, span) is exported, so a consumer that
  needs another target does not walk `lowerProgram`'s internal trees.

### First user

The [portable expression core](./0020-portable-expression-core.md) defines
its IR as Forma types in `preludes/expr.lisp`. `@formalang/expr` generates
its schema, types and JSON Schema with this step, and `pnpm check` runs
`--check`. The generated files are committed. This puts the generator's own
output under review in this repository before consumers rely on it.

## Alternatives considered

- **Document `generateEffectProgram` and stop.** That would close the Effect
  half for worldvm today. It would leave JSON Schema, plain types,
  `Unit` encoding, generic aliases and freshness to every consumer, and
  type-only files would still go through the Effect program checker.
- **Derive JSON Schema from the generated Effect Schema.** RFC 0011 already
  rejects this for host contracts: it requires loading generated code, and
  ties the contract to one target's annotations. It remains a useful test
  oracle.
- **Keep four emitters.** The mechanics and descriptor generators would
  continue to diverge. This RFC does not remove the descriptor and protocol
  emitters, but new schema work targets the shared wire mapping.

## Conformance

- `conformance/json-schema/`, from RFC 0011 stage 2, gains the cases above.
  Each case is one declaration with its expected wire schema, Effect Schema
  text, TypeScript text and JSON Schema, or its diagnostic.
- Each generated `schema.ts` and `types.ts` is compiled with strict `tsc`,
  then imported. Sample values encoded by the host decode with the Effect
  codec and validate against the JSON Schema. Values that should fail do.
- A recursive, mutually recursive, and branded-recursive case each load
  without a `ReferenceError`.
- A worldvm-shaped fixture of about 30 declarations, written for this
  repository, pins all four outputs as stored goldens.
- `--check` fixtures cover a stale file, a missing file and an extra file.

## Implementation stages and validation

1. **Fix the standalone printer.** Make `generateMechanicsEffectSchemaModule`
   use `recursiveSchemaNames` and `Schema.suspend`, as the program
   generator does. This is a bug fix that worldvm-style consumers can use at
   once.
2. **Wire mapping and Effect and TypeScript printers.** `Unit` as `null`,
   non-empty lists, `:format "date"`, typed codecs, plain `types.ts`, and
   `schema/unsupported`.
3. **JSON Schema printer.** Shared with RFC 0011 stage 2.
4. **Command, freshness and reflection.** `forma schema`, `--check`, the
   `TypeDeclaration` view, and the reference page.
5. **Generic aliases and brands in recursion.**

Each stage needs a changeset for `@formalang/ts` or `@formalang/host`.

## Decisions still required

- Whether `Unit` should become `null` everywhere, including inside Effect
  programs, rather than only in data schemas.
- Naming for instantiated generic aliases.
- Whether the generator reads a module and its imports (proposed) or a
  single file, and whether imported declarations are emitted or referenced
  from another generated package.
- Whether `forma schema` belongs to the low-level JSON CLI or waits for the
  `forma` command proposed in [RFC 0013](./0013-runnable-host.md).

## Related designs

- [RFC 0011](./0011-signatures-as-contracts.md): this RFC implements its
  mapping as a build step and adds the Effect and TypeScript printers.
- [RFC 0007](./0007-type-normalization.md): computed record types in
  schemas.
- [RFC 0024](./0024-declaration-and-package-identity.md): the canonical JSON
  that generated schemas describe.
