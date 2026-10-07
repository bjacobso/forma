# @formalang/editor

CodeMirror and React editor integrations for Forma, including syntax highlighting,
diagnostics, completions, and structural editing.

```sh
npm install @formalang/editor react react-dom
```

Use `@formalang/editor/codemirror` for CodeMirror integrations and
`@formalang/editor/react` for React components. The package ships compiled ESM
and TypeScript declarations. React 19 is a peer dependency.

Forma is pre-alpha. See https://forma-lang.com for documentation and demos.

Light/dark appearance and syntax palettes are independent. `LispEditor` accepts
`theme="light"` or `theme="app-dark"` and `syntaxPalette="forma"`, `"ocean"`, or
`"orchid"`. Changing these props preserves the document and undo history. For a
custom CodeMirror integration, use `editorAppearance(mode, palette)` from
`@formalang/editor/codemirror` inside a reconfigurable `Compartment`.
