# Language services for structural editors

This note records the decisions behind the language services that a
structural, outline-based Forma editor needs. Its first consumer is a
workbench in which every outline row is one Forma form, shows its own value
and errors, and is edited by refactorings and an assistant instead of text
patches. The services live in `@formalang/ts` and `@formalang/host`, have no
UI dependencies, and are equally useful to the language server, the
CodeMirror editor, and the playground.

The services are:

1. **Stable node identity** across edits and reparses.
2. **Per-expression observation**: the last value, evaluation count, and
   failure of every author-written expression.
3. **A symbol index**: definitions and references for every defining form,
   including forms that come from macros and descriptors.
4. **An id-addressed edit script**: structural edits that name nodes, not
   offsets.
5. **An outline codec** between source and an outline of rows.
6. **Slot affordances**: which slots a form accepts and which are empty.

The symbol index comes before the edit script because scope-aware rename and
extract depend on it.

## Shared principles

- **Offsets stay the ground truth.** Every record carries a span. Ids are an
  index over spans that survives edits; they never replace spans.
- **Pure functions in `@formalang/ts`, optional methods on the host.** Each
  service is a pure function over source text (plus descriptors where
  relevant) exported from `@formalang/ts`. `LanguageHost` gains optional
  methods with JSON-safe requests and results, and `version().capabilities`
  lists the ones a host implements. Requests that already exist gain only
  optional fields.
- **Stateless requests.** Hosts keep no editor state. A caller that wants
  stable ids passes the previous identity back with the next source.
- **Total over broken input.** Every service accepts source that does not
  parse. The lexer recovers from unterminated strings and unexpected
  characters by producing error tokens instead of throwing, so a parse always
  yields a tree with `Error` nodes and located errors.
- **TypeScript first.** These services are implemented in the TypeScript
  engine. The OCaml host does not implement them yet; the gaps are recorded
  in `conformance/engine-parity/matrix.json`. Identity, the outline codec, and
  the edit script depend only on the reader grammar, which both engines
  already share and compare in the parity runner.

## 1. Identity model

**Identified elements.** Every syntax node except the root (lists, vectors,
maps, sets, symbols, strings, numbers, booleans, reader macros, and error
nodes) and every line comment gets an id. Delimiters and whitespace do not.
A comment belongs to the node whose interior contains it, so comments have
parents and sibling positions like expressions do. Outline rows need this:
comments are rows.

**Shape.** `identifySyntax(source)` returns a `SyntaxIdentity`: the nodes in
document order, each with `id`, `kind`, `span`, `parent`, and `index` among
its parent's identified children, plus a monotone `nextId` and the parse
errors. Ids are opaque strings; generated ids use a configurable prefix
(`n1`, `n2`, …) so they never collide with ids a caller supplies.

**Reconciliation.** `reconcileSyntax(previous, source)` gives the new tree
ids from the previous one. It runs four deterministic passes and never
assigns one old id to two new nodes:

1. **Anchors.** Callers that know where a node went (the edit script does)
   pin spans to ids. A pinned subtree's descendants follow by structure.
2. **Unchanged positions.** The text change is either supplied as
   `changes` or computed as the common prefix and suffix of the two texts.
   Offsets outside the changed region map across it. A node keeps its id if
   its kind is unchanged and both of its boundaries map to the new node's
   boundaries. Insertions at a node's start map its start after the
   insertion, and insertions at its end map its end before it. So ancestors
   of an edit keep their ids, and a node whose text was retyped in place
   (`foo` → `bar`) keeps its id.
3. **Moved subtrees.** Remaining nodes are matched by a structural signature:
   kind plus the token texts of the subtree, ignoring whitespace. A match is
   taken only when exactly one unmatched old node and one unmatched new node
   share the signature. Cut-and-paste moves and reformatting keep ids.
4. **Same slot.** An unmatched node whose parent matched takes the id of the
   old node at the same child index if it has the same kind and is still
   unmatched.

Everything else gets a fresh id.

**Guarantees.**

- A node outside every changed region keeps its id, and so does every node
  whose delimiters were not touched by the change.
- A node edited in place keeps its id while its kind is unchanged.
- A subtree moved with identical tokens keeps its ids when its signature is
  unambiguous. Ambiguous duplicates, such as two identical `(log x)` forms,
  are not guessed at; they keep ids only through positions or anchors.
- Ids are never reused. Deleted ids are retired, and `nextId` only grows.
- The result is a pure function of its inputs.

Incremental reparsing with green-node reuse was considered and rejected for
now. Reparsing is cheap at editor scale, and tree matching also covers
edits that arrive as whole-text replacements from a source pane or a
formatter.

## 2. Observation record shape

Observation is opt-in. `observe` on `EvaluateRequest` or
`EvaluateInSessionRequest` asks the engine to record, for each author-written
expression that ran, an `ExpressionObservation`:

```ts
interface ExpressionObservation {
  readonly nodeId: string; // from the request's identity, or a fresh one
  readonly span: Span;
  readonly count: number; // times evaluated
  readonly value?: ValueProjection; // last value, bounded, possibly a handle
  readonly failure?: Diagnostic; // a failure raised at this expression
}
```

`EvaluationResult.observations` (and the `failed` evaluation state) carry
the records with `truncated` and `limits`. Failed evaluations return their
records too: the values computed before the failure and the failure itself
are what an editor shows.

**Where records come from.** The VM is the production runtime, so it is
instrumented rather than replaced. When observation is on, the compiler
emits an `OBSERVE` instruction after each observed expression and compiles
those expressions out of tail position so that their values return to the
frame that observes them. `OBSERVE` is not counted as a step, but each call
moved out of tail position costs one extra return step, and deep recursion
uses frames instead of being looped. The step limit still applies. Programs that need
the evaluator fallback get the same hook in the evaluator.

**Mapping expansions back to source.** The expander rebuilds lists and
copies source traces. It now also records each rebuilt node's *origin*: the
author-written node it came from. A macro call's expansion root takes the
call as its origin. A record is kept only for nodes whose origin is in the
author's parse, so template nodes from a macro definition, including
prelude macros whose offsets point into another file, never produce records.
Arguments passed through a macro keep their own records, and the call
records the expansion's value.

**Failures** are attributed to the innermost observed expression whose span
contains the failure's source trace.

**Limits.** `maxRecords` (default 5,000 expressions), `maxItems` per
collection (default 20), `maxDepth` (default 4), and `maxStringLength`
(default 500) bound the result. Engines keep only the raw last value and
count during the run and project once at the end, so loops cost a counter
increment per observation. Truncated collections end with an opaque item
tagged `truncated`. In a session, `retainValues: "all"` gives each recorded
value a `valueRef`, so an editor can fetch the full value later with
`projectValue`.

**Not in this version.** Evaluation still stops at the first failure.
Evaluating top-level forms independently so that one failure does not hide
later results would change evaluation semantics and is follow-up work.

## 3. Symbol index

`indexSymbols(documents, options)` returns definitions and references with
spans, node ids, and the defining form. It works from three sources:

- **Expanded core forms.** The program is expanded with the same expander
  the evaluator uses, and a scope walker resolves `define`, `fn`, `let`,
  `match`, `define-type`, `define-typeclass`, and `instance` in the expanded
  program. Results map back to author nodes through origins. A macro that
  expands to a `define` defines the author's symbol, and macro-introduced
  temporaries are never reported.
- **Descriptors.** For forms registered with `define-form`, identifiers
  marked `(:declaration true)` define global names. Descriptors come from the
  session's preludes, from `define-form`s in the indexed documents, and from
  callers.
- **A fallback** for heads that are neither macros nor descriptors keeps the
  language server's existing behavior: `(define-* name …)` defines `name`.

Locals shadow globals. A symbol whose name has a global definition anywhere
in the indexed documents references it. Unresolved symbols are reported as
such so an editor can distinguish builtins and typos.

## 4. Edit-script schema

An edit script is data. It is decoded with Effect Schema, and
`editScriptJsonSchema()` emits the same contract as JSON Schema for a model's
structured output.

```ts
interface EditScript {
  readonly version: 1;
  readonly description?: string;
  readonly ops: readonly EditOp[];
}

type Place =
  | { readonly before: NodeId }
  | { readonly after: NodeId }
  | { readonly parent: NodeId | null; readonly index?: number }; // default: end

type EditOp =
  | { op: "replace"; target: NodeId; text: string }
  | { op: "insert"; at: Place; text: string }
  | { op: "delete"; target: NodeId }
  | { op: "wrap"; targets: NodeId[]; head: string } // contiguous siblings
  | { op: "splice"; target: NodeId } // remove a list's delimiters
  | { op: "unwrap"; target: NodeId } // remove its delimiters and head
  | { op: "raise"; target: NodeId } // replace the parent with the target
  | { op: "move"; target: NodeId; to: Place }
  | { op: "rename"; target: NodeId; to: string } // scope-aware
  | { op: "extract"; target: NodeId; name: string }; // free locals become parameters
```

**Decisions.**

- **Ids refer to the base document.** Operations apply in order. An id stays
  valid until an earlier operation deletes it, and every id is checked before
  anything changes. A script either applies completely or not at all, with
  errors that name the failing operation.
- **New text is source.** `text` and `head` are Forma source, parsed before
  use. Malformed text is an error, not a guess. Text that ends in a comment
  is followed by a line break so it cannot comment out what comes after it.
- **Splice and unwrap differ.** `splice` is paredit's splice and keeps every
  element; `unwrap` also drops the head, which is what removing a
  `(sequence a b)` wrapper means.
- **Layout is kept.** Edits splice text. Moved and wrapped subtrees keep their
  internal formatting and are re-indented by the column shift, never inside
  string literals.
- **Ids are carried.** The result has the new source and a reconciled
  identity in which moved, wrapped, raised, and renamed nodes keep their ids,
  and a change list (`added`, `removed`, `moved`, `edited`) for previews.
- **Context for a preview.** `describeNodes(source, identity, ids)` returns
  the kind, text, parent, head, and enclosing top-level form for each id, so
  a model receives the same handles it must return. The result includes
  before and after text for each affected top-level form.
- **Rename is scope-aware.** It renames a binding and the references that
  resolve to it, using the symbol index, and refuses names that would
  capture or be captured.
- **Extract** moves a form into a new `define` placed before the top-level
  form that contains it. Its parameters are the form's free locals (symbols
  bound by an enclosing local scope), and the form is replaced by a call.

The existing offset-based `@formalang/ts/editor` transforms stay for
keyboard commands in text editors. The edit script shares their text
splicing approach but resolves targets through ids.

## 5. Outline codec rules

The outline is `{ id, text, children }` rows. Row ids are node ids, so the
same identity serves both views. The encoding follows indentation-sensitive
Lisp in the style of SRFI 119 ("wisp"): a row's text holds the leading
elements of its list, and its children hold the rest.

**Reading source into rows.**

- An element that fits on one line is one row. A list with two or more
  elements is written without its parentheses (`(f x)` → `f x`); anything
  else keeps its text (`(f)`, `()`, `x`, `"s"`, `[a b]`, `'(a b)`).
- A list that spans lines becomes a row whose text is the elements that
  start on its opening line, plus a trailing comment on that line, and whose
  children are the remaining elements. When the first element starts on a
  later line, the text is empty and the head is the first child.
- A reader-macro form that spans lines (`` `(if ~test …) ``) becomes a row
  whose text starts with the prefix followed by a space: `` ` if ~test ``.
  The prefix marks the list, the same convention wisp uses for quote.
- A comment on its own line is a row whose text is the comment. A comment
  run whose `;` sits deeper than the previous comment row nests under it,
  so a commented-out subtree reads back as a subtree.
- Other elements that span lines, such as multi-line strings, vectors, and
  maps, are one row whose text is their exact source, newlines included.
- A parse error does not stop reading. Error nodes become rows that carry
  their errors, and an unclosed list reads to the end of the document,
  because that is what the text means.

**Printing rows as source.**

- A row with children prints as `(` + text + children + `)`. A childless row
  with two or more elements prints as `(` + text + `)`. A childless row with
  one element prints as its text. An empty childless row prints nothing.
- A row whose text ends in a comment closes its list on a new line.
- A row whose text starts with a reader-macro prefix and a space, and that
  has children, prints as the prefixed list.
- Children of a comment row print as comments.
- Each row starts on its own line, indented two spaces deeper than its
  parent, unless a base document says otherwise.

**Layout survives in both directions.** Printing accepts a base: the source
and identity the outline was read from. For each row that existed in the
base with the same predecessor, the printer reuses the original text between
the predecessor and the row (indentation, blank lines, a trailing comment's
position) and the original text before the closing delimiter. Rows that
moved or are new get the canonical layout. Reading source and printing it
back with itself as base reproduces the source exactly. Printing an outline
and reading it back reproduces the rows.

**Row errors stay local.** Each row's text is parsed on its own. A row that
does not parse is reported with its errors. By default it prints verbatim;
with `brokenRows: "comment"` the printer comments the row and its subtree
out, so the rest of the document still parses and evaluates.

## 6. Slot affordances

`formSlots` takes a source and an offset or node id. It finds the innermost
form whose head has a descriptor and returns the descriptor's identifiers
and slots. For each slot it reports the occurrences present (spans and ids),
whether it is required, repeatable, or empty, and an insertion point with
template text such as `(:trigger )`. An editor can then render placeholders
such as `+ trigger` and fill one with an `insert` edit. Descriptors come
from the same sources as the symbol index.

## Deferred

- OCaml implementations of these host methods (tracked in the parity
  matrix).
- Evaluating top-level forms independently after a failure.
- Incremental reparsing with green-node reuse.
- Cross-file references in the language server beyond open documents.
