# Repair diagnostics and fill typed holes

A teammate left an incomplete billing module in `bench/agent/fixtures/typed-hole-repair/`.
Copy its three `.lisp` files (`types.lisp`, `billing.lisp`, `main.lisp`) into the
sandbox root, then resolve every diagnostic and fill every typed `?hole`.

Run `forma check main.lisp` (or the MCP `check` / `explain` tools when MCP is
enabled) to inspect the repair-protocol diagnostics (retired form spelling,
unbound-symbol suggestion, record-field typo) and the typed holes (`?net`,
`?priority-fee`, `?some-label`, `?grand-total`), each reporting its expected
type and in-scope candidates.

Preserve every exported name, type, field, and function signature:
- `Tier = (Union :standard :priority)`
- `Invoice = {:id String :subtotal Int :discount Int :tier Tier :note (Option String)}`
- `Summary = {:id String :net Int :surcharge Int :total Int :label String}`
- `net-amount : Invoice -> Int`
- `tier-surcharge : Tier -> Int -> Int`
- `format-label : (Option String) -> String`
- `summarize : Invoice -> Summary`

Behavior specification:
- `net-amount`: clamp `discount` below at `0`, subtract it from `subtotal`, and
  clamp the result below at `0`.
- `tier-surcharge`: `:standard` returns `0`; `:priority` returns `0` when
  `net <= 0`, otherwise `(+ 250 (quot net 10))`.
- `format-label`: `None` returns `"unlabeled"`; `(Some text)` trims `text` and
  returns `"unlabeled"` if empty, otherwise the trimmed text.
- `summarize`: returns `{:id inv.id :net net :surcharge surcharge :total (+ net surcharge) :label (format-label inv.note)}`.

Target: 20–60 minutes. Write the requested files in the sandbox root. Do not edit supplied context.
Use `forma check main.lisp` and `forma file evaluate main.lisp` (or the MCP `check` and `run` tools).
Hidden tests import your public API, vary inputs, and check diagnostics and source locations.
Use only `.lisp` for Forma source. No network or dependencies are needed.
