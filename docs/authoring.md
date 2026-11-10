# Authoring your own program

This page is for people writing Forma outside this repository's own tests and
examples. It shows how to write files, check them, run them, elaborate forms,
and read the results. Forma is pre-alpha: the commands below are the JSON CLI
from a source checkout, and their output shapes may still change.

## What you can build

- **Evaluated programs.** Types, pure functions and a final expression. Check
  them with `file typecheck` and run them with `file evaluate`.
- **Form-based languages.** A module defines `form`s whose `:check` hooks
  report author diagnostics and whose bodies produce typed IR. Other files use
  those forms. `file declarations` elaborates them and lists the IR. See
  [Writing a form](./writing-a-form.md).
- **Effect TypeScript.** Explicit Effect declarations and programs generate
  TypeScript modules. See [Forma for Effect](./effect.md).

## Setup

Use Node.js 24 and pnpm 10.20. Check with `node --version`: pnpm does not stop
you from installing with an older Node. There is no published `forma` CLI yet:
from a source checkout, build `@formalang/host` and run its `dist/cli.mjs`.

```sh
pnpm install --frozen-lockfile
pnpm --filter @formalang/ts build
pnpm --filter @formalang/host build
alias forma="node $PWD/packages/host/dist/cli.mjs"
forma help
```

`forma help` lists every command and exits 0. An unknown command prints the same
text on stderr and exits 64.

## Your first file

Save this as `main.forma`:

```lisp
(type Risk (Union :low :high))
(type Vendor {:name String :risk Risk :reviewed-on (Option Int)})

(: reviewed? (-> Vendor Bool))
(define reviewed? [vendor]
  (match vendor.reviewed-on
    (Some day) (>= day 0)
    None false))

(: acme Vendor)
(define acme {:name "Acme" :risk :high :reviewed-on 900})

(reviewed? acme)
```

Check it, then run it:

```sh
forma file typecheck main.forma
forma file evaluate main.forma
```

`file evaluate` typechecks first. If the check fails, it prints the typecheck
response (with `"pass":"typecheck"`) and does not run the program. Use
`forma file evaluate --unchecked main.forma` to run a program without checking
it, for example while exploring a builtin the checker does not type yet. An
unchecked run can succeed on a program that the checker rejects.

Every command prints one JSON object with `ok`, `value` and `diagnostics`:

| Command | Useful fields |
| --- | --- |
| `file typecheck` | `type` (display string of the final expression) |
| `file evaluate` | `value.result.printed`, `value.result.value` |
| `file declarations` | `value[]`, one entry per declaration (see [Getting the IR](#getting-the-ir)) |
| `file interface` | `value.interfaces[]`, the exports of every module |

File commands exit with status 0 when `ok` is true and 1 when it is false.

## Imports in file modules

A file that uses `import` or `export` is a module, and every name it uses must
be declared in the file, imported, or built in. Import paths are relative to
the importing file.

The kernel library `preludes/kernel.forma` exports `not`, `when`, `unless`,
`cond`, `and`, `or`, `->` and `->>`. In a file module, import the ones you use:

```lisp
(import "../forma/preludes/kernel.forma" [and or not when cond])
```

Without the import, the checker reports `module/unimported-sugar` and names
this library. `not` is different: a file with no `import` or `export` can use
it as a builtin, and a file with either reports `Unbound variable: not` until
you import it. `if`, `let`, `do`, `fn`, `define`, `match` and `type` are core
forms and are always available. The browser playground and `request` mode load the kernel for
you, so examples written there may need this import in a file.

## Builtins

The checker accepts the builtins in the first table. The second table lists
builtins that evaluate but that the checker does not type yet: a checked
program that uses them is rejected with `Unbound variable`, and runs only with
`file evaluate --unchecked`.

| Area | Checked builtins |
| --- | --- |
| Arithmetic | `+ - * /` (variadic), `min max abs`, `mod quot` (Int), `sqrt` (Float → Float), `floor ceil round` (Float → Int) |
| Comparison | `= !=` (any type), `< <= > >=` |
| Logic | `and`, `or` and `not`, imported from the kernel library |
| Lists | `count first rest nth map filter reverse reduce conj concat` |
| Records and maps | `get assoc dissoc merge keys vals select-keys contains? empty? count` |
| Strings | `str format`, `trim split starts-with? ends-with? count` |
| Options and results | `Some None Ok Err`, `Option.Some`, `Result.Ok`, `Result.Err` |
| Symbols and keywords | `sym keyword keyword/name symbol? keyword?` |
| Other | `fail` (String → Never), `id` |

| Area | Evaluate-only builtins (not checked yet) |
| --- | --- |
| Lists | `some every? sort-by group-by distinct flat-map into list get-in` |
| Strings | `upper lower` |
| Predicates | `nil? number? string? boolean? map? list? fn?` |

There is no `string/` namespace and no `range`. `concat` combines two lists of
the same element type; use `str` to concatenate strings. `conj` appends one
element. `reduce` takes a callback, an initial accumulator, and a list, calling
the callback with the accumulator first and the element second. `quot` divides
Ints, truncating toward zero; a zero divisor is a runtime error.

These checked collection signatures describe fully applied calls. Unchecked
runtime `concat` also accepts zero or more lists and `conj` accepts multiple
elements; those extra arities are not part of the shared checked contract.

## Records and Option across modules

A field typed `(Option T)` holds `None` or `(Some value)`. When a record
literal is checked against a named record type, an omitted optional field
becomes `None` and a plain value becomes `(Some value)`. This works for record
types declared in the same file and for imported ones:

```lisp
(import "./types.forma" [Vendor])
(: beacon Vendor)
(define beacon {:name "Beacon" :risk :low})   ; :reviewed-on is None
```

Records computed with `Pick`, `Omit` or `Merge` do not fill implicitly yet:
write `Some` and `None` there. Field access with a dot (`beacon.name`) works on
local and imported record values.

## Polymorphism

Top-level definitions are generalized in dependency order, so a generic
function can be used at different types by later definitions:

```lisp
(: same? (-> a a Bool))
(define same? [x y] (= x y))
(define a (same? 1 1))
(define b (same? "x" "y"))
```

Definitions that call each other form one group. Inside that group they are
monomorphic, as in standard Hindley–Milner inference. Give a definition an
explicit signature when you need it to stay generic.

Arithmetic on an unannotated parameter infers `Float`, because `Int` widens to
`Float`. `(define inc [x] (+ x 1))` has type `Float -> Float`, so its result
does not check against `Int`. Give numeric helpers a signature such as
`(: inc (-> Int Int))`.

## Writing tests

Forma has no test framework. A practical pattern is a test file whose final
expression is the list of failing case names:

```lisp
(import "../forma/preludes/kernel.forma" [not])
(import "./policy.forma" [can-activate? acme])
(type Case {:name String :ok Bool})
(: is (-> String a a Case))
(define is [name actual expected] {:name name :ok (= actual expected)})
(define cases [(is "acme can activate" (can-activate? acme 1000) true)])
(map (fn [c] c.name) (filter (fn [c] (not c.ok)) cases))
```

Run it with `file evaluate` and treat any result other than `[]` as a failure.
Because `file evaluate` typechecks first, an ill-typed suite fails instead of
reporting `[]`. To check that the suite can fail, flip one expectation and
confirm that the case name is reported. The vendor-risk trial in
[`trials/vendor-risk`](https://github.com/bjacobso/forma/tree/main/trials/vendor-risk)
uses this pattern, with a small Node runner.

## Writing a form

[Writing a form](./writing-a-form.md) covers form syntax. Points that matter
when you write forms in files:

- **Hole values in hooks.** `:check`, `:scope` and the projection body receive
  plain runtime values. An omitted optional hole is `nil` and a supplied one is
  the bare value, not `(Some value)`. Test an optional hole inside the hook
  with `(= (get h :due) nil)`. Do not pass it to a typed helper that matches
  `Some`/`None`: convert it first, or use a required hole with a sentinel.
  Absent optional fields are omitted from the IR.
- **Helpers.** A `:check` may call functions defined in the form's module and
  functions that module imports, including ones that use kernel macros.
- **Diagnostics.** Each `:check` returns a list of
  `{:severity :error :code "..." :message "..." :slot :hole}` records. Every
  failing application in a module is reported in one run, each at its slot.
  A hook that fails to run is reported as `elaborate/hook-failed` at the form
  application, naming the helper and where it failed.
- **Exported functions.** `file declarations` needs representable types. A
  function whose inferred type has an open record reports
  `module/unrepresentable-signature`. Give it a signature whose records list
  every field.

### Getting the IR

`file declarations` lists the program's declarations, followed by one
`FormApplication` entry for each form application in every module:

```json
{"summary": {"kind": "FormApplication", "form": "vendor", "name": "acme",
             "moduleId": "/path/register.forma"},
 "payload": {"kind": "Vendor", "name": "acme", "status": "active", "blockers": []},
 "span": {"sourceId": "/path/register.forma", "startOffset": 120, "endOffset": 410}}
```

`payload` is the projection's IR as plain JSON: record keys lose their leading
`:`, and symbols and keywords become strings. The other entries (`SchemaDef`,
`FunctionDef`, ...) are the declarations used for code generation; their names
are resolved module names.

### Authored syntax in an embedded compiler

`elaborateProgram` and `elaborateSources` from `@formalang/ts/descriptor`
return `ElaboratedDeclaration`s with `authored` and `syntax`. You do not need
to parse the source a second time or join nodes by source ID and offset:

```ts
const declaration = result.declarations[0]!;
const original = declaration.authored; // Original top-level SExpr.
const name = declaration.syntax.holes.name?.[0];
const secondChildValue = declaration.syntax.holes.child?.[1]?.holes.value?.[0];
// Each node exposes expression (SExpr), span (named source), and holes.
```

Every named hole is an array: a scalar has one node; a list or repeated hole
has one per element in source order, including an empty array when supplied
empty. An omitted optional hole has no entry. Child forms retain their own
named holes recursively. A `Syntax` hole retains its complete S-expression,
including nested lists, vectors and map entries; this reflection does not
make arbitrary syntax typechecked. Legacy descriptor forms without a surface
hole pattern retain their expression but have no named `holes` entries.

`authored` is the original top-level expression, before action lowering or
macro expansion. For declarations produced by a macro (including several
declarations from one call), it is the original call; within a top-level
`do`, it is that enclosing expression. `syntax.expression` is the recognized
form after expansion. Generated nodes have call-site blame spans rather than
an invented editable range; consult `origin` before making source edits.
Ordinary authored nodes have exact value spans, with their source ID on
`syntax.span`. S-expression offsets use JavaScript string indices.

`sourceMap` is unchanged: it maps selected **payload JSON-pointer paths** to
source spans, for example `/fields/0`. It already covers some projected child
values but is not a complete map of holes: a projection may rename, omit or
rearrange them. `syntax` is independent of that projection and includes holes
that do not appear in the payload. All the new data is JSON-serializable and
is not added to packaged artifact contracts.

## Modelling time

Forma has no date or time type. Model a date as an `Int` day number (days since
an epoch you choose) and do calendar arithmetic, such as month lengths, in the
host that calls Forma. Write each rule's boundary as a test: for example, that
a review on day 364 is current and one on day 365 is expired.

## Reading diagnostics

Each diagnostic has a `code`, `severity`, `message`, `phase` and usually a
`span` with `sourceId`, `startOffset`, `endOffset`, `startLine`, `startColumn`,
`endLine` and `endColumn` (lines and columns start at 1). Messages use the names
you wrote. Common codes:

| Code | Meaning |
| --- | --- |
| `typecheck/type-mismatch` | Two types do not unify. The message gives the location. |
| `module/unimported-sugar` | A kernel macro was used without importing it. |
| `module/private-type` | A public declaration exposes a type that is not exported. |
| `module/unrepresentable-signature` | A definition's inferred type cannot be listed as a declaration. |
| `elaborate/hook-failed` | A form hook raised an error while running. |
| Your own codes | Diagnostics returned by a form's `:check`. |
| `internal/error` | An engine bug. Please report it with the input. |

## Known gaps

See [Domain modeling](./domain-modeling.md#what-the-model-can-t-express-yet)
and the [roadmap](./roadmap.md). Gaps that affect outside authors today: no
date type, evaluate-only builtins (above), and no test runner.
