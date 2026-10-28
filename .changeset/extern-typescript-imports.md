---
"@formalang/ts": minor
---

Add `extern` to Effect programs. `(extern "./module.js" declaration...)` binds exports of an existing TypeScript module (schemas, classes, tagged errors, services, layers, pure functions, constants, and operations) under declared Forma types. The mechanics checker checks every use like a local declaration. The generator imports only the bindings the module uses instead of defining them, so TypeScript checks the declarations against the real exports. Imported declarations package under the new `mechanics/extern-def/v0` payload contract. Single-file programs only; file modules, the HM checker, and the hosted runtime do not run `extern` yet.
