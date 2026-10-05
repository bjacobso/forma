---
"@formalang/ts": minor
"@formalang/host": patch
---

Add `elaborateProgram` to `@formalang/ts/descriptor`. It elaborates a whole DSL source against a bootstrapped prelude and returns JSON payloads shaped as packageable declarations, with spans that include end lines and columns, plus structured diagnostics for parse errors, unknown or unsupported forms, duplicate declarations, missing identifiers and required slots, and construct failures. Also adds `elaborateProgramOrThrow`, `ElaborationFailure`, `formatDiagnostic`, `declarationDiagnostic`, `sourceLocator`, `toJsonValue`, and `isJsonRuntimeStringLiteral`. Engine and host diagnostics accept the new `"elaborate"` phase.
