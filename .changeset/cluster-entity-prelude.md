---
"@forma-language/forma": minor
---

**Experimental.** Add a prototype Effect Cluster prelude (`cluster.lisp`) and `@forma-language/forma/cluster`. `entity`, `command`, and `query` declare an entity's state, pure transitions, and delivery; `generateClusterProgram` checks each transition as an ordinary Effect function and emits native `Entity.make`, `Rpc.make`, and `Entity.toLayer` code for Effect 4.1.1. The prelude rejects persisted state-changing commands without a `:dedupe-by` key, keys that are not String or Int payload fields, persisted commands over in-memory state without `:accept-state-loss true`, and queries that update state. State is in memory only. Form emit hooks gain `ts/fields`, which renders a record type as `Schema.Struct.Fields`.

The `/cluster` and `/effect-system` subpaths and `generateEffectSystem`'s `extensions` option are experimental; expect them to change in a minor release. Importing `forma:effect/rpc`, `/http-api` or `/cluster` is the preferred way to select a library, and the `extensions` option remains for single-source programs.
