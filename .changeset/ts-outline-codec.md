---
"@formalang/ts": minor
"@formalang/host": minor
---

Add an outline codec for structural editors. `sourceToOutline` in `@formalang/ts/syntax` reads source as rows in the style of indentation-sensitive Lisp (SRFI 119): a row's text holds the leading elements of its list and its children hold the rest, comments are rows, multi-line literals stay whole, and broken text becomes rows with errors instead of failing. `outlineToSource` prints rows line for line, reuses the base document's layout for unchanged rows so reading and printing a source with itself as base is exact, gives every printed row's node the row's id, and can comment out rows that do not read. `TsLanguageHost` implements the optional `sourceToOutline` and `outlineToSource` host methods.
