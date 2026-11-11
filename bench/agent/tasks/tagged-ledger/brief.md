# A typed event ledger
Write `types.lisp`, `ledger.lisp`, `main.lisp` (barrel). Export Role =
(Union :manager :finance :auditor), Event = (Tagged (Charge {:cents Int
:role Role}) (Refund {:cents Int}) Void), and Summary = {:net Int :charges Int
:roles (List Role)}. ledger exports generic identity : a -> a and same : a -> a
-> Bool, required : Int -> List Role, summarize : List Event -> Summary,
and amounts : List Event -> List Int. required returns [] for <=7500,
[:manager] for 7501..250000, [:manager :finance] above 250000. summarize
ignores Void, subtracts refunds, counts Charge events, and retains charge roles
in event order (including duplicates). amounts maps Charge to positive cents,
Refund to negative cents, Void to zero. Use generic map/filter/reduce with tagged
values, and keep closed unions valid across module boundaries and generic
identity/same calls. Handle empty collections. main reexports the full API.
Public signatures must retain Role/Event rather than widening to Keyword.

Target: 20–60 minutes. Write the requested files in the sandbox root. Do not edit supplied context.
Use `forma check main.lisp`, `forma file evaluate main.lisp`, and (for forms)
`forma file declarations main.lisp`. Hidden tests import your public API, vary
inputs, and check diagnostics and source locations. Use only `.lisp` for Forma
source. No network or dependencies are needed.
