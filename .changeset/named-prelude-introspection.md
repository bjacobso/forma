---
"@formalang/ts": minor
---

Support `bootstrapFromSources([{sourceId, source}, ...], options?)` alongside the existing string signature. Named prelude definition diagnostics retain each file's ID and offsets, and the original inputs are available as `sourceInputs` without changing `sources`.

Add `FormDescriptorRegistry.getChildForms(formName, holeName)` using the compiler's child-family rules, export `closestName` from `/diagnostic`, and support an optional source ID in `toSExprMany`. Existing registry listings already expose forms, holes, and types; consumers no longer need to scrape prelude text or concatenate files.
