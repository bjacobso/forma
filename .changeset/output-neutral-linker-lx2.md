---
"@forma-language/forma": minor
---

Generalize the module linker into an internal output-neutral `LibraryAdapter` interface and resolve file-module descriptor form family blockers: slash-qualified local declarations, nested `Refers` validation, child form dispatch in defining module scope, hook-only compile-time helper classification, and `:emit` + `:graph` hooks for non-Effect JSON-emitting libraries under plain `forma check`, while keeping `forma:effect/{rpc,http-api,cluster}` passing through the same linker.
