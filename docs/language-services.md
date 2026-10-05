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

**Mapping expansions back to source.** The expander emits a fresh tree and
gives each node one origin (7.3). The engine asks the observer about every
expression it compiles or evaluates, and a record exists exactly for the
author nodes behind a `source` node or an `expansion` root. Template nodes of
a macro definition, including prelude macros whose offsets point into another
file, are copied as `introduced` and never produce records. Arguments passed
through a macro keep their own records, and the call records the expansion's
value.

**Failures** are located at author code: a `source` node's own position, or,
for code a macro introduced, the innermost macro call the author wrote. A
failure is attributed to the innermost expression the engine evaluated or
compiled whose span contains that location. A failure during expansion, such
as a macro's arity, belongs to the macro call.

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
  use. Malformed text is an error, not a guess.
- **The result reads as the intended tree.** Each operation states the tree
  it intends, and `commit` checks that the new source reads as exactly that
  tree (7.1). Grammar rules are checked on the intended tree: a reader macro
  keeps one form, which comes last; braces keep their kind, so a map is not
  turned into a set or back (`edit/brace-kind`); a map holds pairs
  (`edit/map-entry`). Text is joined so that a comment never runs into code
  and atoms never fuse.
- **Splice and unwrap differ.** `splice` is paredit's splice and keeps every
  element; `unwrap` also drops the head, which is what removing a
  `(sequence a b)` wrapper means.
- **Layout is kept.** Edits splice text. Moved and wrapped subtrees keep their
  internal formatting and are re-indented by the column shift, never inside
  string literals.
- **Ids come from the intended tree.** Moved, wrapped, raised, spliced, and
  renamed nodes keep their ids; a replacement of the same kind keeps the
  replaced node's id, and its contents get fresh ones. The result has the new
  source, its identity, and a change list (`added`, `removed`, `moved`,
  `edited`) for previews.
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
- A list with two or more elements that spans lines becomes a row whose
  text is the elements that start on its opening line, plus a trailing
  comment on that line, and whose children are the remaining elements. A
  multi-line list element ends the text and becomes a child row. When nothing
  but a comment follows `(` on the opening line, the text is empty and the
  comment is the first child, because a row whose text starts with `;` is a
  comment.
- Continuation lines of a row's text are stored relative to the row's
  column, so a row's text does not change when its row moves.
- A reader-macro form whose list spans lines and has children
  (`` `(if ~test …) ``) becomes a row whose text starts with the prefix
  followed by a space: `` ` if ~test ``. The prefix marks the list, the same
  convention wisp uses for quote. A plain list whose opening line would read
  the same way (`(' a …)`) gets an empty text instead, so the two never mix.
- A comment on its own line is a row whose text is the comment. A comment
  run whose `;` sits deeper than the previous comment row nests under it,
  so a commented-out subtree reads back as a subtree.
- Other elements that span lines, such as multi-line strings, vectors, and
  maps, are one row whose text is their exact source, newlines included.
- A parse error does not stop reading. Error nodes become rows that carry
  their errors, and an unclosed list reads to the end of the document,
  because that is what the text means.
- A row's text is exactly the source of its elements. A carriage return
  before a line break belongs to the line break, so it is not part of a
  text that ends in a comment.

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
- Whitespace around a text's tokens and comments is not part of it; the
  spaces at the end of a comment are.

**Well-formed outlines** are the normal forms reading produces from readable
source, and law 1 of 7.2 holds for them. Broken rows remain printable and law 2
still applies to their source, but they are outside law 1. Concretely, every
row satisfies these conditions:

- its text reads without errors, has no whitespace around its tokens and
  comments, and every element of it starts on its first line;
- no element of its text is a multi-line list that reading would make a
  row of its own;
- a comment row is one line, and its children are comment rows;
- with children, a text that starts with a prefix marker does not continue
  with a comment;
- without children, its text is not empty, and a single element has no
  trailing comment and is not a list of two or more elements (that is
  written without parentheses);
- with children, it has at least two elements counting text and children,
  or a child that has children.

**Layout survives in both directions.** Printing accepts a base: the source
and identity the outline was read from.

- A row whose text and children are unchanged, at the same column, prints
  as the exact base text of its node, children and all.
- For other rows that existed in the base with the same predecessor, the
  printer reuses the original text between the predecessor and the row
  (indentation, blank lines, a trailing comment's position), the text
  between `(` and the row's text, the text before the closing delimiter,
  and the row's text exactly as written when it is unchanged at the same
  column. Rows that moved or are new get the canonical layout, shifted with
  their parent.
- The reader tells a row's text from its children by line, and reused layout
  can change that: a list whose children end up on its opening line reads as
  one row. So the printer reads each printed row with children back, and if
  it does not read as the same row, prints that row's own seams the
  canonical way, which always does. This is the one place law 1 is checked
  while printing.
- Pieces are joined with `SourceBuilder`, so a comment never runs into what
  follows it.

Reading source and printing it back with itself as base reproduces the
source exactly, for any text. Printing a well-formed outline, with or without
a base, and reading it back reproduces the rows and their ids.

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

## 7. Invariants and where they are enforced

An adversarial review of the first versions found seventeen bugs in five
groups, and each was patched where it appeared. A second review looked for the
cases those patches missed and found more than fifty, pinned in
`packages/ts/test/review-*.test.ts`. This section records, for each group, the
invariant the bugs broke, the root cause, the design that replaces the
case-by-case patches, and what the design guarantees. Property tests over
random programs are the evidence. CI runs them at moderate counts;
`FORMA_PROPERTY_SCALE=20 pnpm --filter @formalang/ts test` runs them twenty
times longer.

### 7.1 Edit scripts produce the tree they intend

**Invariant.** An operation is a transformation of the syntax tree: the forms
and comments of the identity, with atoms and comments compared by their text.
Applying it yields source whose parse is exactly the intended tree. The
operation chooses only whitespace. So no token moves into or out of a comment,
no two atoms fuse, a reader macro keeps exactly one operand, braces stay a map
or a set, and every comment keeps its text, parent, and position.

**Root cause.** Operations built text by concatenating slices, and each had to
know every lexical hazard at each of its seams: a line comment runs to the end
of its line, adjacent atoms read as one, a prefix binds the next form, and the
reader decides between a map and a set by looking at the contents. The check
for new parse errors could not see a violation, because commented-out code,
fused atoms, and a set where a map was all still parse.

**Design.**

- *Seams are safe by construction.* Every piece of text is appended through
  `SourceBuilder` (`syntax/lexical.ts`), whose law is
  `lex(a ⧺ b) = lex(a) ++ lex(b)`, comments included. At a seam that would
  break the law it inserts the smallest separator that keeps it: a line break
  after an open comment, otherwise a space.
- *Operations compute an intended tree.* Each operation edits a copy of the
  tree whose nodes carry ids, and states its preconditions there. Grammar
  rules are checked once, on the intended tree, for every operation: a reader
  macro holds one form, braces hold an even number of forms unless they read
  as a set, and new text reads on its own. Semantic rules stay with the
  operation that has them: `raise` and `extract` take forms, and `extract`
  takes an expression (7.4 says which positions are expressions).
- *One choke point.* `commit` reparses the assembled text and compares it
  with the intended tree, node by node. A difference fails the operation with
  `edit/structure`. Property tests check that this never happens, so it is a
  safety net, not a behavior.
- *Ids come from the intended tree.* A node keeps the id the operation gave
  it. New nodes get fresh ids, and removed ids are gone. Edit scripts no
  longer reconcile, so ids cannot move to look-alike nodes, and no anchors or
  retired lists are needed.
- *Rename and extract check the expanded program.* Macros are unhygienic, so
  a rename can change what a macro's expansion refers to without touching any
  author-written reference. Capture is checked over every reference in the
  expanded program, author-written and macro-introduced, keyed by provenance
  (7.3). Names the kernel provides stay reserved for new definitions.

**Guarantees.** A successful operation's result parses as its intended tree.
A failed one names the rule it broke. Text outside the edited forms is
byte-identical. Ids are never reused within a script or across scripts.

### 7.2 The outline codec is a pair of functions with laws

**Laws.**

1. `read(print(o)) = o` for every well-formed outline `o`, ids included.
2. `print(read(s), base: s) = s` for every string `s`, including text that
   does not parse.
3. Printing loses no text: every token of every row appears in the output,
   in order.

**Root cause.** Reading and printing were two sets of heuristics written
separately. Exactness with a base came from reusing pieces of layout one at a
time (separators, closings, row texts), and the printer trimmed the texts it
then compared with the base, so every odd layout needed its own case.

**Design.**

- *A grammar.* Reading is a total case analysis over the syntax tree. Printing
  is its inverse on well-formed outlines, which are the normal forms reading
  produces from readable source. The rules and the well-formedness conditions are in
  section 5.
- *Verbatim reuse.* With a base, a row whose text and children are unchanged
  prints as the exact base text of its node. Text between two rows is reused
  when they were neighbors in the base. So law 2 holds by construction: an
  unchanged outline reuses every byte. Texts are compared as written, never
  trimmed.
- *Seams go through `SourceBuilder`.*
- *Generators cover the grammar.* The program generator in
  `test/support/programs.ts` covers every token type, CRLF, lone carriage
  returns, tabs, missing and extra whitespace, broken input, and reader macros
  in every position. A second generator builds outlines directly, so law 1 is
  tested on outlines that no source in the first generator produces.

**The prefix stays in the text.** A row with children whose text starts with
a reader-macro prefix followed by a space, or by nothing, is a prefixed list.
The reader never writes that text for anything else. A structured `prefix`
field was considered. It would give the wire format two encodings that can
disagree, and an outline's text is what a person types.

### 7.3 Provenance is data, written once

**Invariant.** Every node of an expanded program has one origin, fixed when
the node is created. No node object appears twice in an expansion or is
shared with the parse, a macro definition, or another expansion.

**Root cause.** Origins and source traces lived in `WeakMap`s keyed by object
identity and were added to over time. Macros returned the same template
objects from every expansion, and `tagExpandedExpr` rewrote the traces of
argument nodes. So the last expansion's facts won, and a diagnostic inside a
macro argument pointed at the call, or into the prelude. Separately, "the
origin is in the author's parse" stood in for "this is author code", which is
false for a template written in the same file.

**Design.** The expander copies everything it emits and gives each copy one
origin with a role:

- `source`: author-written code at this position, including an argument a
  macro passed through;
- `expansion`: the root of a macro expansion, which stands for the call;
- `introduced`: built by a macro, from its template or by computation;
- `desugared`: written by the expander for an author form, such as a
  destructuring temporary.

A `source` node keeps its own location; the chain of macro calls it passed
through is context, not a replacement. Every origin names its *site*, the
author node it is located at: itself for `source`, the innermost author call
for `introduced`, the author form for `desugared`. An emitted node's `loc` is
its site's, so traces are never rewritten and diagnostics always point into
the author's document.

*Storage.* Origins live in a registry keyed by the fresh nodes
(`expander/provenance.ts`), not in a field, because expanded nodes flow into
runtime values that are compared structurally. Recording a second origin for
a node throws, so sharing fails where it happens. Public origins, their author
arrays, and their macro context entries and arrays are frozen, so a caller
cannot rewrite recorded facts through `originOf`. Arguments are recognized by
identity with the nodes handed to the macro, before copying.

*Nested expansions.* A root whose call is itself a root stands for what that
call stands for, so a macro that expands to another macro call records its
author's call. A root whose call a macro introduced (the recursive `cond`) is
located at the author's call but stands for no author node: the outer root
already records that call, and recording it again would count one evaluation
twice.

**Evaluable is decided by evaluation.** A record exists for a node exactly
when the engine evaluated it as an expression and its origin is `source` or
`expansion`. Quoted data, templates, macro bodies, binders, patterns, and type
positions are never evaluated as expressions, so they never get records, and
no list of exclusions is needed. A macro body that runs during evaluation
runs unobserved. A macro supplied as a runtime value records its call through
the surrounding evaluation; its expansion observes arguments and nested
author expressions without counting that call again. The evaluator fallback
leaves tail position for observed
calls, as the VM does, so self tail calls are observed; the VM names a failed
call the same way in and out of tail position. The fallback validates a self
call's arity before making a tail-call sentinel, so the trampoline cannot lose
the failed call's location. A failure goes to the innermost
expression the engine evaluated or compiled whose span contains its location.
A failure during expansion, such as a macro's arity, goes to the macro call.
It is also located there when it has no location or was raised inside a macro
the program did not define, such as a prelude macro, whose location is in
another source.

**Guarantees.** Observation never changes a result or a message, on the VM or
the fallback; only step counts differ, as section 2 says. Every record names
an author node, and two expansions never share a record. An invariant test
expands every program in the corpus (examples, preludes, conformance cases,
test fixtures) and checks that every node has exactly one origin, is fresh,
and is located in the parsed document. Random nested expansions also check
that repeating an expansion emits disjoint trees with frozen origins.

### 7.4 Scope is described once

**Invariant.** A reference resolves to the binding the language gives it.

**Root cause.** The index re-described the language's binding forms in its own
walker, over a program the expander had already partly lowered without
origins. Every place where the walker and the evaluator described a form
differently was a bug.

**Design.**

- The index resolves the expanded program. Destructuring and other sugar are
  lowered by the evaluator's own expander, with origins (7.3), so the walker
  sees only core binding forms.
- The core binding forms are described once, as data
  (`language/binding-forms.ts`): which positions bind, into which scope, and
  which are expressions, patterns, types, quoted data, or templates. The index
  walks it; `extract` asks it whether a position is an expression.
- Special forms and macros are recognized by name before locals, as in the
  evaluator. Locals shadow globals and builtins.
- A differential property checks the description against the evaluator:
  renaming a binding and the references the index reports to a fresh name
  never changes a program's result.

**Globals.** A global is one mutable cell per name in one environment, into
which sources are loaded in order. Every `define` of the name, at any depth
and in any file, is a definition site of the same global, so find-references
on any of them finds all of them and every reference. A reference's primary
definition is the last site before it in load order, or else the first after
it; that is the value it reads in straight-line code. The language server
indexes open documents and preludes in one fixed order, whichever document
asks, and caches the index per set of document versions.

**Patterns.** Where the evaluator and the typechecker read a pattern
differently, the index follows the typechecker: the head of a list pattern is
a constructor reference, and other symbols bind.

### 7.5 Reconciliation is tree matching with a stated objective

**Objective.** Find a one-to-one, kind-compatible matching between old and new
nodes that respects anchors and retired ids and, in order of priority,
maximizes (1) the nodes in matched identical subtrees, (2) containers whose
matched descendants correspond, and (3) nodes the text change left in place.

**Root cause.** Ids were assigned by passes over one prefix/suffix diff. The
order of the passes decided between a node and its wrapper, tied signatures
fell through to a same-slot guess that crossed lineages, and an anchored
parent's structural follow could claim ids that other anchors named.

**Design.** A deterministic matcher in the style of GumTree:

1. *Anchors* are hard constraints, placed before anything else. An anchor
   cannot bring back an id the caller retired, or an id the previous identity
   generated and no longer has.
2. *Supplied changes* map positions exactly; nodes whose boundaries map
   through them match first.
3. *Top-down*: identical subtrees, largest first. Tied candidates pair in
   document order, preferring pairs whose positions map through the change
   and whose parents matched.
4. *Bottom-up*: containers by the share of their matched descendants.
5. *In place*: nodes whose boundaries map through a computed diff.
6. *Recovery*: the same kind in the same slot of matched parents, only
   between atoms of equal text or containers, so lineages do not cross.

**Guarantees,** as properties over random sequences of edits: ids are unique,
never reused, and `nextId` never decreases; nodes outside every change keep
their ids; a wrap, raise, or splice written as a whole-text replacement keeps
the inner nodes' ids and gives a new wrapper a fresh one; a move keeps the
moved subtree's ids when its text is unique, and duplicates keep theirs in
order; anchors are honored.

## Deferred

- OCaml implementations of these host methods (tracked in the parity
  matrix).
- Evaluating top-level forms independently after a failure.
- Incremental reparsing with green-node reuse.
- Cross-file references in the language server beyond open documents.
