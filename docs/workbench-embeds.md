# Live workbench embeds

The homepage and [Effect page](/effect) mount a source-first workbench. It runs
Forma in a Web Worker and uses the real compiler's output. The full
<a href="/workbench/demo/" target="_self">structural workbench</a> remains a separate destination for
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

## Themes

Appearance and syntax colors are separate choices: Light or Dark, and Forma,
Ocean, or Orchid. The source and generated-code editors share the selected
palette. `editorAppearance(mode, palette)` is exported by
`@formalang/editor/codemirror`; `LispEditor` also accepts `syntaxPalette`.
Reconfigure a CodeMirror `Compartment` to change appearance without recreating
the editor, losing focus, or clearing its undo history.

The docs embed follows the surrounding page's light/dark setting and offers
its own controls. Theme messages accept only the same origin and the owning
parent frame. Each frame reports its content height so the docs can stack the
source and output on narrow screens without clipping diagnostics. Theme and
palette preferences persist locally; source drafts do not persist across reloads.

The outline workbench uses Foldworks themes. Extending these palette controls to
that app requires mapping the same semantic colors to its source, outline,
inspector, diff, and diagnostic tokens; these embeds do not add that integration.

## What should come next

The homepage now demonstrates contracts, failures at authored calls, generated
Effect code, row inference, macro expansion, and pure evaluation. The ambition
section links to the working structural editing and proposal-review experience.
The next demonstrations should make the language-extension promise concrete:

- **Define a domain form and use it in the same project.** Completion, slots,
  diagnostics, and artifact changes should all follow edits to its descriptor.
  Ontology elaboration currently needs the OCaml engine; browser ontology output
  in the older playground remains a labeled fixture.
- **Move between source, outline, and a domain view.** Preserve document identity,
  selection, and undo while changing the representation.
- **Review semantic consequences.** Show a proposal's tree diff beside diagnostics,
  inferred requirements, and observed values before applying it.
- **Follow a contract across files.** Navigate definitions, compose layers, inspect
  module output, and show which missing dependency blocks a complete program.

To support those consistently, both editor surfaces need shared dialect-aware
host analysis, scoped completion and definition lookup, stable source mapping,
a common theme contract, and generated artifacts in the host result. Source
maps back from generated TypeScript, persistent drafts, and execution traces
remain follow-ups. Effect and general HM analysis still have different contracts;
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
