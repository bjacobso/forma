---
"@forma-language/forma": minor
---

**Breaking:** Diagnostics now carry 1-based start and end line/column positions in their source spans in engine and in-process host results. Messages no longer include position suffixes. CLI file responses keep diagnostics only in the top-level array, removing the duplicate arrays inside `value` and `value.result`.
