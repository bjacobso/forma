# Library-defined runtime operations

This fixture exercises generic compiler foundations for a composed application
DSL. It does not implement Foldkit Blocks or change the Elm prototype's target.

- `vocabulary.forma` defines a checked declaration form with a passive `:lower`
  projection into ordinary signatures and definitions.
- `store.forma` declares a shared Service and a typed failure.
- `feature.forma` defines an argument-bearing operation, an inferred factory of
  pure Model Steps, deferred work, and an Effect constructor returning a captured
  handler.
- `public.forma` re-exports the feature through a barrel.
- `main.forma` consumes the feature with namespace and named imports.
- `callback-layer.lisp` checks the standalone Effect target's capture of a
  deferred callback's Service requirements when it implements a Layer method.

`packages/ts/test/module-lowering.test.ts` checks both interface facets, compiles
the generated files under strict TypeScript settings without `any`, and runs them
against real Effect Service Layers. It asserts no Service calls at import,
independent callback execution, constructor work once per execution, typed
failure payloads, and a captured handler that requires no Service when invoked.
Rejection tests cover malformed projections, callback channels, source locations,
and kernel refusal to execute Effect initializers.
