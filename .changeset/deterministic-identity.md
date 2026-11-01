---
"@formalang/ts": minor
"@formalang/host": patch
---

Make expansion and identity reproducible. `gensym` numbers names per expansion
pass and per top-level evaluation instead of from a process-wide counter, so
the same program expands to the same names regardless of earlier work.
`GensymScope` and `withGensymScope` are exported from `Evaluator`. Source hashes
and the session prelude fingerprint are now SHA-256 (previously 32-bit FNV-1a),
and the fingerprint no longer depends on locale or separator characters in
source ids. Source hashes are computed on first use.

The TypeScript host keeps keyword, symbol, and string map-key kinds when it
projects values, including bounded observations, and when it decodes host-call
results and arguments. A function or opaque projection whose `valueRef` is
retained in the session decodes to the retained value instead of its display
text.
