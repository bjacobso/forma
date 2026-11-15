# Live workbench embeds

The homepage and [Effect page](/effect) mount a source-first workbench. It runs
Forma in a Web Worker and uses the real compiler's output. The full
<a href="/workbench/demo/" target="_self">structural workbench in Foldworks</a> is a separate app for
outline editing, modules, the REPL, proposal review, and capability approvals.

## The authoring loop

A useful embed needs one source revision and one analysis result. Red underlines,
the problem list, the type inspector, IR, and generated code must all describe
that revision. Debounce typing, ignore superseded responses, clear stale spans
when the source changes, and put a watchdog around compiler execution. A failed
check should preserve the body types available from that check and block code
generation. It should never imply that an earlier output belongs to the new code.

The Effect demos call `generateEffectProgram` once per revision. The checker
provides declared signatures and inferred body types, including the failures
and method capabilities introduced by calls. The worker converts its type maps
into serializable, located expression types before sending the result to the UI.
The general-language examples use the engine's read, expand, typecheck, and
bounded evaluation passes. General-engine expression types can be top-level
summaries; the embed locates those using the corresponding reader form.

Click a diagnostic or expression type to reveal its authored span. Source
editing uses CodeMirror history, bracket matching, folding, and the existing
Forma structural keymap. Analysis performs no service calls. The Effect embed
checks and generates programs; it does not execute their I/O.

## Demonstrating typing

**Watch typing** is an optional, explicit replay. It starts from a valid program,
introduces a contract mistake, waits for the real diagnostic, and types the
repair. Every edit takes the ordinary compiler path. Stop, Reset, selecting an
example, or editing the source interrupts playback. With reduced motion enabled,
the repair is applied without character delays. There is no automatic typing
that could overwrite someone's draft while they are reading.

## Layout

The workbench is built from the reader's parts. The code pane is the reader:
hover for types and prelude documentation, widen and narrow the selection by
form, structural edits, and the type at the caret under the code. The lens
beside it follows the selection: the selected form's type, effect, and prelude
form; each operation's declared signature beside what its body infers; the
generated Effect TypeScript, where the statements generated from the selected
form are highlighted and clicking a statement selects its source; and the typed
IR, expansion, or value for the general-language examples. The compiler's stages
and problems sit under both, and clicking a problem selects its span. Code and
lens share one fixed height, so changing the lens or the selection never moves
the page.

## Themes

The workbench follows the site's light or dark theme and draws with the reader's
palette, so the code, the lens, and the hover cards agree. The docs embed follows
the surrounding page's setting. Theme messages accept only the same origin and
the owning parent frame. Each frame reports its content height so the docs can
stack the source and output on narrow screens without clipping diagnostics.
Changing the theme reconfigures the editor without recreating it, losing focus,
or clearing its undo history. Source drafts do not persist across reloads.

The outline workbench is owned by Foldworks and uses its themes.

## What should come next

The homepage now demonstrates contracts, failures at authored calls, generated
Effect code, row inference, macro expansion, and pure evaluation. The ambition
section links to the working structural editing and proposal-review experience.
The next demonstrations should make the language-extension promise concrete:

- **Define a domain form and use it in the same project.** Completion, slots,
  diagnostics, and artifact changes should all follow edits to its descriptor.
  The browser playground does not run ontology elaboration yet; its ontology
  output remains a labeled stored golden.
- **Move between source, outline, and a domain view.** Preserve document identity,
  selection, and undo while changing the representation.
- **Review semantic consequences.** Show a proposal's tree diff beside diagnostics,
  inferred requirements, and observed values before applying it.
- **Follow a contract across files.** Navigate definitions, compose layers, inspect
  module output, and show which missing dependency blocks a complete program.

To support those consistently, both editor surfaces need shared dialect-aware
host analysis, scoped completion and definition lookup, stable source mapping,
a common theme contract, and generated artifacts in the host result. The
generated TypeScript links back to source per declaration, not per expression;
finer source maps, persistent drafts, and execution traces remain follow-ups. Effect and general HM analysis still have different contracts;
the Effect embeds choose the Effect checker explicitly.

## Embedding

The docs theme registers `WorkbenchEmbed`. For example:

```vue
<WorkbenchEmbed example="orders" title="Live order payments" />
<WorkbenchEmbed example="contracts" broken title="Missing capability" />
```

The iframe route is `/playground/embed/:exampleId`; the full-page source view is
`/playground/live/:exampleId`. Both render the same `LiveWorkbench` component
used on the playground homepage. The website worker serves cold loads of both
routes from the playground app shell.

## Forma code blocks

Every `lisp` or `forma` code fence in these docs is a live block. The page
loads with the highlighted code; as a block nears the viewport, the playground's
prototype reading editor replaces it at the same size. The reader checks the code
as you edit it, shows types and prelude documentation on hover, widens and narrows
the selection by form (<kbd>Alt</kbd>+<kbd>↑</kbd> and <kbd>Alt</kbd>+<kbd>↓</kbd>),
puts the type at the caret under the code, and opens the inspector on demand. All
blocks on a page share one checker. The website's
<a href="/playground/read/snippets" target="_self">snippets page</a> shows the same
reader inline, and how its parts compose into other layouts.

Words after the language set a block's options:

````md
```lisp file=helpers.lisp
(export [double])
(define double [n] (* n 2))
```

```lisp preludes=ontology
(entity Person {:name String})
```

```lisp fragment
(f 5)
```
````

- `file=name.lisp` names the block's file. Blocks on one page that name their
  files can import each other.
- `preludes=ontology` checks against another bundled prelude stack: `effect`
  (the default, with RPC, HTTP API, and Cluster), `ontology`, `ui`, `email`,
  or `elm`.
- `fragment` keeps a block static, for an excerpt or code in another Lisp.

A page's `formaBlocks` frontmatter sets how its blocks relate. `separate`, the
default, checks each block alone. `continued` puts every earlier block without a
file name in scope, for a page that builds one program step by step. `static`
keeps every block on the page static. The website's `docs-blocks` test checks
every live block, so a block that stops checking fails CI.
