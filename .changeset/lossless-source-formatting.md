---
"@formalang/ts": minor
"@formalang/host": minor
"@formalang/language-server": minor
"@formalang/editor": minor
---

Add lossless source formatting for Lisp, Forma, and Markdown Lisp/Forma fences.
Preserve token spellings, comments, blank-line boundaries and ignored regions;
report invalid Lisp and skipped fragments without rewriting them. Export pure
formatting and range APIs, descriptor/macro layouts, and minimal whitespace edits.

Add `forma fmt`, stdin/check/strict modes, the optional host `format` method and
JSON operation. Resolve formatter layouts through imports for the CLI and LSP.
Enable LSP document and range formatting by default, including Markdown fences
and unsaved dependencies; set `FORMA_LANGUAGE_SERVER_ENABLE_FORMATTING=0` to
opt out. Add undoable editor commands and shortcuts, a workbench source Format
command, and a playground Format button. Migrate the corpus and review stored
source-position goldens separately from behavior changes.
