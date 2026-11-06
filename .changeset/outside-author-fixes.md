---
"@formalang/ts": patch
"@formalang/host": minor
---

**Breaking:** `forma file evaluate` now typechecks first and returns the typecheck
response when it fails; pass `--unchecked` to evaluate without checking. File
commands exit 1 when `ok` is false, and `help`/`--help` exit 0.

`file declarations` lists each form application's elaborated IR as a
`FormApplication` entry. Generic top-level functions stay generic across later
definitions; implicit `Some`/`None` filling and field access work for imported
record types; form `:check` hooks can call imported helpers; every failing form
application is reported. JSON diagnostics carry lines and columns and use author
names, and hook failures are located at the form application.
