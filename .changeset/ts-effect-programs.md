---
"@formalang/ts": minor
---

Make Forma an authoring language for Effect TypeScript programs. `@formalang/ts/mechanics` adds `elaborateEffectProgram` and `generateEffectProgram`, which read, project, check, and generate an Effect 4 module and report line and column diagnostics. It also adds `checkMechanicsDeclarations`, a checker over the portable mechanics IR. The checker verifies schemas, declared errors and requirements, exhaustive `match`, possible `catch`, non-failing finalizers, and layer completeness.

The mechanics surface gains:

- layers (`define-layer` with `:provides`/`:setup`/`:methods`, `layer-merge`, `layer-provide`, `layer-provide-merge`, `provide`);
- Schema classes (`define-class`) and typed functions and constants (`(: f T) (define f ...)`);
- zero-argument operations;
- multi-clause and catch-all `catch`;
- Effect combinators: `acquire-release`, `scoped`, `ensuring`, `all`, `for-each`, `race`, `fork`/`join`, `timeout`, `retry`, `map-error`, `option`, `result`, `config`, `decode`, `log`, and `Ref` operations;
- streams;
- value-level `match`;
- a library of pure value functions;
- `Option`, `Result`, `Ref`, `Fiber`, `Stream`, and function types.

The generated module now uses Schema-backed data, `Schema.TaggedError` and `Schema.Class` classes, camelCase operation names, `undefined` for `Unit`, and Effect 4 call shapes. `generateMechanicsEffectSchemaModule` now emits Effect 4 call shapes: `Schema.Union([...])`, `Schema.Tuple([...])`, `Schema.Literals([...])`, and `Schema.optionalKey`. This changes the generated code: operation exports are camelCase (`always_fail` becomes `alwaysFail`), errors are classes, and conditions must be `Bool`.
