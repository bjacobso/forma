---
"@formalang/host": minor
---

**Breaking:** Remove the OCaml language hosts. `NodeOcamlLanguageHost`, `JsOcamlLanguageHost`, `parseOcamlJson`, and the `./ocaml-host` and `./js-ocaml-host` entry points are gone, along with the `FORMA_OCAML_CLI` and `FORMA_OCAML_JS` settings. Use `TsLanguageHost`, `createDefaultLanguageHost`, or the `forma` JSON CLI and daemon instead.
