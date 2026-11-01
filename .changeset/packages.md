---
"@formalang/ts": minor
"@formalang/host": minor
---

Add package imports (RFC 0018). `(import "@acme/flows/ir" [FlowIR])` resolves
through the `forma.exports` field of an installed package's `package.json`.
Modules may import only packages their own package declares, and package
modules get location-independent `pkg:<name>/<path>` identities. The compiler
takes a host package table (`ModuleCoreOptions.packages`, `configureSession({
packages })`); `@formalang/ts/node` builds one from `package.json` files and
`node_modules`, rejects two versions of one package, and the `forma file`
commands use it. Packages may declare a prelude for their own modules. Session
loading no longer bootstraps a file module's own forms as session descriptors,
so a module's form can use an imported `:ir` type in sessions and the CLI.
