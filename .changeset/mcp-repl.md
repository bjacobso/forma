---
"@forma-language/forma": minor
---

`forma mcp` has a `repl` tool: a code-mode session where an agent writes Forma or `:commands`. Definitions persist per session; `:effect` builds an Effect program cell by cell and reports declared and inferred types, `:infer`, `:ts`, `:expand` and `:run` check, generate and run it (in a Node permission-model process that can read only the `effect` package), `:prelude` defines or replaces session preludes so the language can evolve during a session (the session replays earlier inputs, and applications of prelude forms elaborate to IR), and `:doc`, `:modules`, `:source` and `:examples` expose docs, bundled modules and the Effect conformance programs. `@forma-language/forma/mechanics` now exports `expandEffectLibrary` and `expandEffectDeclarations`, and `/modules` exports `bundledModuleSources`.
