# The outline is the program

This note states what the Forma workbench is for. [Workbench](./workbench.md)
records how it is built.

An outline and an S-expression are the same object. A Forma form is a head
followed by arguments, and an outline row is a line of text followed by
children. If every row is a form, the tree is the primary editing surface and
parenthesized text is one way to view it. Structure stays visible, every row
has an identity that survives edits, and a person and an assistant edit the
same program objects instead of line ranges.

A row is not a picture of the program. It is a form the language services
know: it has an id, a value, a type, the definitions it uses and the rows that
use it, and the slots its form still expects.

The idea was first explored in Foldworks with a teaching-sized Lisp, an
interpreter written for the demo, and a hand-made row codec. The workbench
starts again from Forma's language services, so every fact a row shows comes
from the real reader, expander, type checker, evaluator, and elaborator.

## How rows become Forma

The outline codec writes a program the way indentation-sensitive Lisp in the
style of SRFI 119 ("wisp") does. A row's text holds the leading elements of its
list, and its children hold the rest.

| Outline                                     | Forma                                |
| ------------------------------------------- | ------------------------------------ |
| `define total [x]` with child `* x 2`       | `(define total [x] (* x 2))`         |
| `total 21` with no children                 | `(total 21)`                         |
| `total` with no children                    | `total`: one element is that element |
| `(now)`                                     | `(now)`: a call with no arguments    |
| `; note`                                    | a comment, which is a row too        |
| `` ` if ~test `` with children              | a quasiquoted list                   |
| empty text with children                    | a list whose head is its first child |

Inline lists, vectors, and maps work anywhere in a row's text. Reading source
and printing it back with itself as the base reproduces it exactly, so
switching between rows and text never reformats a program. Rows that did not
change keep their text, comments, and blank lines; rows that moved or are new
take the canonical layout. Text that does not parse becomes rows that carry
their errors, and the rest of the program still reads.

## Notation is a dial

The same outline renders more than one way. **Outline** shows bullets and
rows, the friendlier reading for people who think in steps rather than syntax.
**Brackets** turns each list row's bullet into `(` and paints its `)` after the
last row the list contains, so the outline reads as source. The brackets are
painted, not typed: they can never be unbalanced, and editing still happens one
row at a time. The source pane shows the same program as text, edited as text
and read back into rows.

Neither is the real program; the tree is. Other notations fit the same model:
a folded `workflow` can draw as its flow while the rest of the program
stays rows, and a plain-language reading for people who never see code would
fit the same way.

## What is live

Every edit is analyzed, and every row shows what it means now.

- **Values.** Each row shows the last value its expression produced and how
  many times it ran, from per-expression observation. Rows inside functions
  show their latest call. Values inside macro calls belong to the arguments the
  author wrote. A structured value is a handle whose branches load when the
  inspector opens them. Domain forms show the payloads produced by real
  elaboration. Descriptor slot clauses are inputs to that elaboration and
  expose their evaluation state rather than an invented runtime value.
- **Types.** Every expression has its inferred type, on hover and in the
  inspector, including inside macro calls and in programs with a type error
  elsewhere.
- **Diagnostics.** Parse, type, evaluation, and elaboration errors are
  underlined in the row where the author wrote the offending code, even when a
  macro rewrote it. Checks a prelude defines, such as a workflow step that may
  read data before another step writes it, appear the same way.
- **Names.** Definitions, references, locals, macros, and descriptor forms are
  highlighted from the symbol index. The inspector shows where a name is
  defined and every row that uses it.
- **Slots.** A form registered by a prelude describes its parts, and a row
  offers the ones it is missing as placeholders, such as `+ system` under a
  `step` without one. Filling one inserts the slot's template.
- **Capabilities.** A row that reaches the outside world says which
  capabilities it needs. Running it asks first.

## Structural edits, not patches

Refactorings act on rows, which are forms: wrap the selection in a form,
unwrap, raise, splice, rename a definition and every reference to it, and
extract a form into a definition whose parameters are its free locals. Each is
an edit script that names nodes by id, so rows it does not touch keep their
identity, the change can be shown as a tree diff, and it undoes as one step.

The outline can have rules of its own. A host can refuse moves that would
break a form, such as dragging a workflow step out of its steps, and can show
shared code in context with its rows read only.

## The assistant contract

The assistant turns a request about the selection into a proposal: an edit
script, the tree it would produce, and the consequences found by analyzing the
proposed program, such as diagnostics cleared or introduced and values that
change. Nothing changes until the proposal is accepted, and accepting it is one
undoable step.

The contract is the same whoever fills it. The assistant receives the selected
rows and the row with the caret as node ids with their text and enclosing
forms, the program around them, and the facts the workbench knows about them.
It returns an edit script, never a line-range patch. The workbench validates
the script against the program's identity, applies it, analyzes the result,
and shows the diff and its consequences before anything changes. A local,
deterministic proposer that understands a handful of phrasings is the default
and the test fixture. A model fills the same schema through structured output,
and the panel says which one answered.

## Limits

- Evaluation stops at the first failure, so rows after a failing form show no
  value until it is fixed.
- Observation keeps each expression's last value and count, not a trace, so
  there is no step-through yet.
- Running a program with capabilities is interactive; programs written with
  Effect definitions are typed with their effects but not run.
- Nothing is persisted.
