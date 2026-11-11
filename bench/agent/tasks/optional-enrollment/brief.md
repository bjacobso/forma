# Enrollment reconciliation
Build a three-module enrollment library, keeping wire omissions distinct from values.
`model.lisp` exports Address {:city String :unit (Option String)}, Contact
{:email (Option String) :address (Option Address)}, and Member
{:name String :contact (Option Contact) :credits (Option Int)}.
`policy.lisp` imports these types and exports:
- label : Member -> String: trimmed nonempty email, otherwise trimmed city,
  otherwise member name. Ignore whitespace-only emails/cities. A unit appends
  " / " and its trimmed value to a nonempty city, except absent/blank units.
- credit : Member -> Int: absent or negative credits become zero.
- reachable? : Member -> Bool: true only with nonblank email or city.
- reconcile : List Member -> {labels (List String), credits Int, reachable Int}:
  preserve member order and sum clamped credits and reachable count.
`main.lisp` reexports the entire public API. Use Some/None matches, support
omitted fields in annotated records and nested records, explicit Options and
bare inline record arguments. Preserve all input fields; no host I/O.

Target: 20–60 minutes. Write the requested files in the sandbox root. Do not edit supplied context.
Use `forma check main.lisp`, `forma file evaluate main.lisp`, and (for forms)
`forma file declarations main.lisp`. Hidden tests import your public API, vary
inputs, and check diagnostics and source locations. Use only `.lisp` for Forma
source. No network or dependencies are needed.
