---
"@formalang/ts": minor
---

Support `:infer-fn function-name` on ordinary `form` definitions, using the existing descriptor infer-hook protocol in the active checker context. Argument-dependent forms can forward inferred type metadata without widening nominal types or replacing checker methods. The option is mutually exclusive with `:type`; existing result hooks and public embedding signatures are unchanged.

The descriptor type provider recognizes domain forms as applications, not meta-phase type descriptions. Source-local nominal constructors therefore keep their normal HM types instead of becoming `Declaration` values.
