---
"@forma-language/forma": minor
---

Add `generateTypeSchemas(sources)` under `/mechanics` and `forma schema <sources...> --out <dir> [--check]`. They generate deterministic Effect codecs, plain TypeScript types, and JSON Schema 2020-12 from explicit source bundles. The freshness check fails without writing stale output. Supported data shapes include refinements, nonempty lists, optional fields, unions, and recursion; unsupported wire encodings produce located diagnostics.

Fix recursive standalone mechanics schemas with suspended references and explicit recursive types. Nonempty list metadata now produces `Schema.NonEmptyArray`. Existing mechanics signatures and Effect-operation `Unit = void` behavior remain unchanged; the new data-only build uses `Unit = null` and finite JSON numbers.
