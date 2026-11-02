# @formalang/editor

CodeMirror and React editor integrations for Forma, including syntax highlighting,
diagnostics, completions, and structural editing.

```sh
npm install @formalang/editor effect@^4.1.1 react react-dom
```

Use `@formalang/editor/codemirror` for CodeMirror integrations and
`@formalang/editor/react` for React components. The package ships compiled ESM
and TypeScript declarations. Effect `^4.1.1` and React 19 are peer dependencies;
reuse the application's Effect runtime across Forma libraries.

Forma is pre-alpha. See https://forma-lang.com for documentation and demos.

Light/dark appearance and syntax palettes are independent. `LispEditor` accepts
`theme="light"` or `theme="app-dark"` and `syntaxPalette="forma"`, `"ocean"`, or
`"orchid"`. Changing these props preserves the document and undo history. For a
custom CodeMirror integration, use `editorAppearance(mode, palette)` from
`@formalang/editor/codemirror` inside a reconfigurable `Compartment`.
