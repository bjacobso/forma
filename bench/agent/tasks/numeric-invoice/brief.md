# Exact invoices and Float telemetry
Write `money.lisp`, `metrics.lisp`, `main.lisp` (barrel).
Export Line {:cents Int :quantity Int :tax-bps Int}, Totals {:net Int :tax Int
:gross Int}, subtotal : Line -> Int, line-tax : Line -> Int,
invoice : List Line -> Totals. Quantities and cents may be negative (credits).
Tax is basis points /10000, rounded to nearest cent with ties away from zero,
PER LINE before summation. Never use Float for money. A 1-cent line at 5000 bps
has 1 cent tax; its negative has -1 cent tax. All intermediate test values fit
safe Int range. Empty invoice totals are zero.
metrics exports Sample {:elapsed Float :units Int}, Stats {:elapsed Float
:units Int :rate Float}, aggregate : List Sample -> Stats, and moving : Float
-> List Float -> List Float. aggregate sums both fields, rate = units/elapsed
as a Float (zero elapsed gives 0.0). moving emits exponential smoothing for each
sample with alpha=0.25 and provided initial Float: next=0.25*x+0.75*previous.
Keep even whole-valued Float results as Floats; hidden probes check inferred
result kinds as well as values. main reexports all contracts.

Target: 20–60 minutes. Write the requested files in the sandbox root. Do not edit supplied context.
Use `forma check main.lisp`, `forma file evaluate main.lisp`, and (for forms)
`forma file declarations main.lisp`. Hidden tests import your public API, vary
inputs, and check diagnostics and source locations. Use only `.lisp` for Forma
source. No network or dependencies are needed.
