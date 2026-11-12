# Authoring your own program

This page is for people writing Forma outside this repository's own tests and
examples. It shows how to write files, check them, run them, elaborate forms,
and read the results. Forma is pre-alpha; command behavior and APIs may still change.

## What you can build

- **Evaluated programs.** Types, pure functions and a final expression. Check
  them with `forma check` and run them with `forma run`.
- **Form-based languages.** A module defines `form`s whose `:check` hooks
  report author diagnostics and whose bodies produce typed IR. Other files use
  those forms. `file declarations` elaborates them and lists the IR. See
  [Writing a form](./writing-a-form.md).
- **Effect TypeScript.** Explicit Effect declarations and programs generate
  TypeScript modules. See [Forma for Effect](./effect.md).

## Setup

Use Node.js 24. Install the public distribution and its required Effect peer:

```sh
npm install @forma-language/forma effect
```

**`@forma-language/forma` is not yet published.** That install command is for
after publication. For now, use a source checkout with pnpm 10.20:

```sh
pnpm install --frozen-lockfile
pnpm exec turbo run build --filter=@forma-language/forma
alias forma="node $PWD/packages/forma/dist/cli.mjs"
forma help
```

With a local npm install, use `npx forma` for the commands below; the source
alias lets you use `forma` directly from any directory in the same shell.

`forma help` lists every command and exits 0. An unknown command prints the same
text on stderr and exits 64.

## Your first file

Save this as `main.lisp`:

```lisp
(+ 20 22)
```

Check it, then run it:

```sh
forma check main.lisp
forma run main.lisp
```

The result is `42`. Next, try the standalone
[project example](https://github.com/bjacobso/forma/tree/main/examples/project),
with a form library and imported data. To embed a language in a Node app, see
[Embedding](./embedding.md) and the
[Node example](https://github.com/bjacobso/forma/tree/main/examples/embed-node).
Both examples are tested against the packed distribution by `pnpm check:examples`.

`check` typechecks the module graph and renders diagnostics with source excerpts
on stderr. `run` checks first, then prints the evaluated value on stdout. Both
exit 0 on success and 1 on failure. Use `forma run main.lisp --unchecked` to run
without checking, for example while exploring a builtin the checker does not
type yet. An unchecked run can succeed on a program that the checker rejects.

Add `--json` to `check`, `run`, `fmt` or `explain` for a JSON response on stdout.
The existing `file typecheck`, `file evaluate`, `file declarations` and
`file interface` commands remain JSON machine interfaces. Their responses have
`ok` and `diagnostics`, with `value` when available:

| Command | Useful fields |
| --- | --- |
| `check --json` / `file typecheck` | `type` (display string of the final expression) |
| `run --json` / `file evaluate` | `value.result.printed`, `value.result.value` |
| `file declarations` | `value[]`, one entry per declaration (see [Getting the IR](#getting-the-ir)) |
| `file interface` | `value.interfaces[]`, the exports of every module |

Format files in place with `forma fmt main.lisp helper.lisp`. For CI,
`forma fmt main.lisp --check` lists files that would change and exits 1 without
writing them. `forma explain typecheck/type-mismatch` explains a diagnostic
offline.

Start a typed, stateful session with `forma repl`. Each successful submission
prints `value : type` and retains its definitions; failed submissions do not
commit. `:type <expr>` checks an expression without evaluating it, `:reset`
clears the session, and `:quit` exits. Repeat `--prelude <file>` to load preludes
at startup and again after reset. Each submission occupies one input line.

## Imports in file modules

A file that uses `import` or `export` is a module, and every name it uses must
be declared in the file, imported, or built in. Relative import paths are resolved from
the importing file; bundled libraries use reserved `forma:` specifiers.

The bundled kernel library `forma:kernel` exports `not`, `when`, `unless`,
`cond`, `and`, `or`, `->` and `->>`. In a file module, import the ones you use:

```lisp
(import "forma:kernel" [and or not when cond])
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
`run --unchecked`.

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
(import "./types.lisp" [Vendor])
(: beacon Vendor)
(define beacon {:name "Beacon" :risk :low})   ; :reviewed-on is None
```

The type must be available at the literal's use site. The same rules apply to
file modules and `createLanguage` programs using prelude or imported types:

| Literal context | Omitted `(Option T)` field | Plain field value |
| --- | --- | --- |
| Annotated binding, `(: value RecordType)` | `None` | `Some value` |
| Argument to a function with a declared record parameter | `None` | `Some value` |
| Expression annotation, `(: {...} RecordType)` | `None` | `Some value` |
| Declared function result, including `if` branches and list elements with a known record type | `None` | `Some value` |
| Record without a known type | No fields added | Value unchanged |

Explicit `Some` and `None` values are preserved. Required fields must still be
provided, and supplied values must match their field types. Filling applies to
literal syntax; it does not add fields to an already computed record value.
In Effect TypeScript schema records, optional fields use optional properties:
omission stays absent, plain values stay plain, and reading the field produces
an `Option`. Form hooks also receive plain values, with `nil` for omitted holes.

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

A literal list can use the enum type supplied by another argument to a generic
function, in either argument order:

```lisp
(type ApprovalRole (Union "manager" "finance"))
(: roles (List ApprovalRole))
(define roles ["manager" "finance"])
(same? roles ["manager" "finance"])
```

Each literal must belong to the union. A computed `String` still needs validation
or an appropriate declared type before it can be used as an `ApprovalRole`.

Definitions that call each other form one group. Inside that group they are
monomorphic, as in standard Hindley–Milner inference. Give a definition an
explicit signature when you need it to stay generic.

Arithmetic on an unannotated parameter infers `Float`, because `Int` widens to
`Float`. `(define inc [x] (+ x 1))` has type `Float -> Float`, so its result
does not check against `Int`. Give numeric helpers a signature such as
`(: inc (-> Int Int))`.

## Writing tests

Write ordinary checked Forma in `.lisp` files and import the test library.
Use `forma:test` in both repository checkouts and installed npm distributions;
no copying or dependency declaration is needed:

```lisp
(import "forma:test" [test is is=])
(import "./policy.lisp" [can-activate? acme])

(test "acme can activate"
  (is (can-activate? acme 1000)))

(test "structural equality"
  (is= [{:amount 42}] [{:amount 42}]))
```

Run `forma test [paths...]`. With no paths it searches the current directory.
Directories discover `**/*-test.lisp` and `test/**/*.lisp`; explicit file paths
run regardless of their names. Discovery skips dependency, build and hidden
repository metadata directories and does not follow directory symlinks. Results
are ordered by canonical file path, then source order; overlapping paths run a
file once. `--filter <substring>` selects names, and `--json` emits one object
with `ok`, `files` (check outcomes and diagnostics), and `results` (module, name,
status, source span and diagnostics). Exit status is 1 for a failed test or file,
0 otherwise, including an empty selection.

Each file is checked in full before any of its tests run, even with a filter.
A check failure reports diagnostics and skips that file; other files continue.
Each selected test gets a fresh session and a 50,000-step evaluation budget.
A runtime error or exhausted budget fails that test; later tests still run.
Module initialization also uses the budget. Tests do not share runtime state.

`test` is a library macro that wraps its body in an unevaluated function. The
runner recognizes top-level `(test "literal name" body...)` calls and evaluates
one selected body at a time. Importing a test module leaves its tests dormant.
Tests may see private definitions in their file. This initial runner supports
kernel evaluation; Effect programs, tags, property generators and `throws?`
are not implemented. It does not add the core declarations or host operation
proposed in RFC 0015. Use the spelling `test` directly, rather than an import
alias, for discovery.

A test passes when its body completes. Use `is` for a Bool condition and `is=`
for structural equality (actual value first, expected value second). Multiple
body expressions run in order; the first failed assertion ends that test.
Assertion failures print expected and actual values and point to the assertion
in the author's source. A bare `false` value is a completed expression, so use
an assertion to make it fail. Helpers return `true` on success and call the
kernel failure builtin on failure. There is currently no checked kernel catch
form, so an expected-failure assertion is deferred.

The trial reports retain their original list-of-failures suites. New
`runner-test.lisp` companions in `trials/vendor-risk/tests` and
`trials/expense-rules/src` demonstrate the runner without rewriting that history.

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
             "moduleId": "/path/register.lisp"},
 "payload": {"kind": "Vendor", "name": "acme", "status": "active", "blockers": []},
 "span": {"sourceId": "/path/register.lisp", "startOffset": 120, "endOffset": 410}}
```

`payload` is the projection's IR as plain JSON: record keys lose their leading
`:`, and symbols and keywords become strings. The other entries (`SchemaDef`,
`FunctionDef`, ...) are the declarations used for code generation; their names
are resolved module names.

### Authored syntax in an embedded compiler

`elaborateProgram` and `elaborateSources` from `@forma-language/forma/descriptor`
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

## Asking what fits with typed holes

Use `?` or `?name` in expression position while writing a program:

```lisp
(: repair (-> Int Int))
(define repair [amount] ?todo)
```

Checking reports `typecheck/hole`: `Hole ?todo needs Int; candidates: amount`.
Its structured `details` contain `name`, `expected`, and `candidates`. The main
checker lists up to ten visible bindings whose types unify with the goal, with
locals before globals and concrete types before polymorphic types in each group.
These are binding replacements; it does not synthesize calls or record skeletons.
Unsolved types use readable letters such as `a`. Each occurrence is a separate
goal, including repeated names. Other top-level forms are still checked.

The CLI displays the goal and candidates, MCP checks retain the details, and the
language server offers a replacement quick fix for each candidate. The Effect
checker reports contextual goals with an empty candidate list. Checked runs
refuse programs containing holes; unchecked evaluation raises an error when it
reaches a hole.

Names beginning with `?` are reserved in ordinary executable expressions. Explicit
host `typePolicy.unboundSymbols` rules still take precedence for unbound query
symbols. Predicate names
ending in `?`, quoted query variables such as `'[?person ?name]`, patterns, and
descriptor syntax slots retain their existing meaning. Descriptor slot errors
use the separate `elaborate/hole-*` codes.

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
date type and evaluate-only builtins (above).
