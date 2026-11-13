---
"@forma-language/forma": minor
---

Add `@forma-language/forma/effect-system`. `generateEffectSystem` links RPC groups, HTTP APIs, and Cluster entities with ordinary Effect declarations into one checked native Effect module, and returns a graph of the program's services, operations, endpoints, RPCs, entities, and their relations. The RPC, HTTP API, and Cluster generators now share this linker; in their output, library imports now come after the `effect` import.
