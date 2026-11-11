---
"@forma-language/forma": minor
---

Add package imports (RFC 0020). `(import "@acme/flows/ir" [FlowIR])` resolves
through the `exports` field of a dependency's `forma.json`.
Modules may import only packages their own package declares, and package
modules get location-independent `pkg:<name>/<path>` identities. The compiler
takes a host package table (`ModuleCoreOptions.packages`, `configureSession({
packages })`); `@formalang/ts/node` builds one from `forma.json`, verified
`forma.lock`, and committed `vendor/` or relative sources. The `forma file`
commands use it. Packages may declare a prelude for their own modules. Session
loading no longer bootstraps a file module's own forms as session descriptors,
so a module's form can use an imported `:ir` type in sessions and the CLI.
