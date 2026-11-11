# Repair the dispatch project
A teammate left a broken project in `bench/agent/fixtures/repair-dispatch/`.
Copy its four .lisp files into the sandbox root, then fix seven seeded errors
across its modules. Preserve every public name, type, field and function
signature described below. Do not edit the supplied tests. Both `forma check
main.lisp` and `forma file evaluate tests.lisp` must pass; tests evaluate true.
Public API (main barrel): Mode = (Union :standard :express), Parcel =
{:grams Int :mode Mode :destination (Option String)}, State = (Tagged
(Ready {:cost Int}) (Blocked {:reason String})), base : Int -> Int,
price : Parcel -> Int, dispatch : Parcel -> State.
base: <=1000g costs 500 cents; every started 1000g after that adds 200 cents
(e.g. 1001 costs 700, 2000 costs 700, 2001 costs 900). base of zero/negative
is 0. Express adds 800 only for positive weights. dispatch returns Blocked
"weight" for nonpositive grams, else Blocked "destination" for absent or
whitespace destination, else Ready with price. Destination text is not altered.
Project structure: model.lisp owns types; pricing.lisp owns base/price/dispatch;
main.lisp reexports everything; tests.lisp is a consumer. Repair underlying
causes, including module/type visibility, arity, unbound names, numeric kinds,
Option matching, and the shipping boundary bug. Run checks after each repair.

Target: 20–60 minutes. Write the requested files in the sandbox root. Do not edit supplied context.
Use `forma check main.lisp`, `forma file evaluate main.lisp`, and (for forms)
`forma file declarations main.lisp`. Hidden tests import your public API, vary
inputs, and check diagnostics and source locations. Use only `.lisp` for Forma
source. No network or dependencies are needed.
