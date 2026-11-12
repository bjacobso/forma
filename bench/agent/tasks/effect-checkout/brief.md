# Checkout contracts
Write an Effect program in `main.lisp`. Export Receipt {:id String :total Int},
error Declined {:id String}, service Payments with charge : String -> Int ->
Effect Receipt [Declined], and service Audit with record : String -> Effect Unit.
Export checkout : String -> Int -> Effect Receipt [Declined]
[Payments.charge Audit.record]. Negative totals fail with Declined before
calling either service. Nonnegative totals charge, then audit the receipt id,
then succeed with the receipt. Export retry-free : String -> Int ->
Effect Receipt [] [Payments.charge Audit.record]: call checkout, recover Declined
with a fallback receipt {id "declined", total 0}, retaining the Audit requirement.
Export preview : String -> Int -> Receipt (pure; clamp negative totals to zero).
The signatures must declare precise errors and requirements. No layer or actual
I/O is needed: hidden checks inspect checked declaration contracts and inject
operations with missing requirements and errors; those must fail at author
source locations. Use `forma file declarations main.lisp` for Effect checking;
`file evaluate` is only for pure helpers. Read the supplied Effect reference.

Target: 20–60 minutes. Write the requested files in the sandbox root. Do not edit supplied context.
Use `forma check main.lisp`, `forma file evaluate main.lisp`, and (for forms)
`forma file declarations main.lisp`. Hidden tests import your public API, vary
inputs, and check diagnostics and source locations. Use only `.lisp` for Forma
source. No network or dependencies are needed.
