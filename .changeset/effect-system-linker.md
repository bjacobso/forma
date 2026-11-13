---
"@forma-language/forma": minor
---

**Experimental.** Add `@forma-language/forma/effect-system`. `generateEffectSystem` links RPC groups, HTTP APIs, and Cluster entities with ordinary Effect declarations into one checked native Effect module, and returns a graph of the program's services, operations, endpoints, RPCs, entities, and their relations. The RPC, HTTP API, and Cluster generators now share this linker; in their output, library imports now come after the `effect` import.

The `/cluster` and `/effect-system` subpaths and `generateEffectSystem`'s `extensions` option are experimental; expect them to change in a minor release. Importing `forma:effect/rpc`, `/http-api` or `/cluster` is the preferred way to select a library, and the `extensions` option remains for single-source programs.
