# Vendor risk trial

Cold-author trial of Forma against the vendor-risk brief. See [REPORT.md](REPORT.md).

- `src/policy.forma`: typed policy functions (evaluate)
- `src/register-forms.forma`, `src/register.forma`: the `vendor` form and a synthetic register (elaborate)
- `tests/policy-test.forma`, `tests/fixtures/`, `tests/traps/`, `tests/run.mjs`

Run: `PATH=/opt/node24/bin:$PATH node trials/vendor-risk/tests/run.mjs` after building `@formalang/ts` and `@formalang/host`.
