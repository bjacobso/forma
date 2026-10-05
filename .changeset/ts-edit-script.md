---
"@formalang/ts": minor
"@formalang/host": minor
---

Add id-addressed structural edit scripts. `@formalang/ts/editor` exports the `EditScript` Effect Schema, `decodeEditScript`, `editScriptJsonSchema` for structured model output, `describeNodes` for the context a model or preview needs, and `applyEditScript`, which applies `replace`, `insert`, `delete`, `wrap`, `splice`, `unwrap`, `raise`, `move`, scope-aware `rename`, and `extract` operations atomically, keeps the author's layout, and returns the new source with a reconciled identity, a change list, and before and after text for each affected form. `TsLanguageHost` implements the optional `applyEditScript`, `describeNodes`, and `editScriptSchema` host methods.
