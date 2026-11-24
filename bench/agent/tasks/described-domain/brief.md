# Author a quota policy language from a described library

A domain library is supplied at `bench/agent/fixtures/described-domain/quota-lib.lisp`.
Do not guess its vocabulary: inspect it first with
`forma describe bench/agent/fixtures/described-domain/quota-lib.lisp` (or
`--format json`, or the MCP `describe` tool when MCP is enabled) to discover
its exported types, helper functions, and forms.

Write two modules in the sandbox root: `policy.lisp` and `main.lisp`.

1. `policy.lisp`:
   - Import the types and helpers you need from
     `./bench/agent/fixtures/described-domain/quota-lib.lisp`.
   - Export `Status`, `ServicePolicyIR`, and the form `service-policy`.
   - `Status` is `(Union "draft" "active")`.
   - `ServicePolicyIR` is:
     `{:kind "ServicePolicy" :name Symbol :plan Plan :region Region :rpm Int :burst Int :effective-burst Int :status Status}`.
   - Define `(service-policy name :plan Plan :region Region :rpm Int :burst Int :status Status)`
     using `{:keys [plan region rpm burst status]}` in the form header,
     with `:types` binding `:name` via `(Declares ServicePolicyDecl)` and typing
     each keyword slot with the imported `Plan`, `Region`, `Int`, and `Status`.
   - `:check` must call the library's `plan-ceiling` and `valid-region?` helpers
     and collect ALL independent errors in a declaration (not stopping at the first):
     - If `rpm <= 0` or `rpm > (plan-ceiling plan)`: emit error
       `quota/rpm-out-of-range` on `:rpm`.
     - If `burst < 0`: emit error `quota/negative-burst` on `:burst`.
     - If `status` is `"active"` and `(valid-region? plan region)` is false:
       emit error `quota/region-not-allowed` on `:region`.
       (`"draft"` policies in a disallowed region project normally.)
   - Project `ServicePolicyIR` with `:effective-burst` computed by the library's
     `effective-burst` helper.

2. `main.lisp`:
   - Import `quota-tier` from `./bench/agent/fixtures/described-domain/quota-lib.lisp`
     and `service-policy` from `./policy.lisp`.
   - Declare at least one valid `quota-tier` and at least three valid
     `service-policy` entries: two `"active"` policies and one `"draft"` policy
     whose region is disallowed for its plan.

Target: 20–60 minutes. Write the requested files in the sandbox root. Do not edit supplied context.
Use `forma describe`, `forma check main.lisp`, and `forma file declarations main.lisp`
(or the MCP `describe`, `check`, and `run` tools).
Hidden tests import your public API, vary inputs, and check projected IR,
diagnostic codes, and source locations. Use only `.lisp` for Forma source.
No network or dependencies are needed.
