# Vendor risk trial

Cold-author trial of Forma against the vendor-risk brief. See [REPORT.md](REPORT.md).

- `src/policy.lisp`: typed policy functions (evaluate)
- `src/register-forms.lisp`, `src/register.lisp`: the `vendor` form, whose `:check` calls the policy, and a synthetic register (elaborate)
- `tests/policy-test.lisp`, `tests/fixtures/`, `tests/traps/`, `tests/run.mjs`

Run: `PATH=/opt/node24/bin:$PATH node trials/vendor-risk/tests/run.mjs` after building `@formalang/ts` and `@formalang/host`.
