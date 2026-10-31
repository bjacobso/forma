---
"@formalang/ts": minor
---

Add local providers to Effect programs: `(provide effect (implement Service ...))` supplies an inline layer whose methods close over local values, and `:delegate` forwards undefined members to the outer implementation. `provide` accepts several layers, each wrapping the ones before it, and warns with `mechanics/provide-order` when a layer uses a service provided inside it. The mechanics checker applies the layer rules to inline methods, discharges the implemented service, and reports `mechanics/implement`, `mechanics/unused-provider`, and `mechanics/unused-delegate`. Inline layers project to `InlineLayer` IR nodes with a payload contract and generate `Layer.succeed` or `Layer.effect`. A tagged `catch` around `provide` now generates code TypeScript can infer.
