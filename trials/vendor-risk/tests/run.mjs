// Test runner for the vendor-risk trial. Source: the trial brief (REPORT.md).
// Usage: PATH=/opt/node24/bin:$PATH node trials/vendor-risk/tests/run.mjs
// Requires the built JSON CLI: pnpm --filter @formalang/ts build && pnpm --filter @formalang/host build
import { execFileSync } from "node:child_process";
import { copyFileSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const cli = join(root, "../../packages/host/dist/cli.mjs");
const forma = (mode, file) => {
  let out;
  try { out = execFileSync(process.execPath, [cli, "file", mode, join(root, file)], { encoding: "utf8" }); }
  catch (e) { out = e.stdout; }
  return JSON.parse(out);
};
let failed = 0;
const t = (name, cond, detail = "") => {
  console.log(`${cond ? "ok  " : "FAIL"} ${name}${cond ? "" : "  " + detail}`);
  if (!cond) failed++;
};
const printed = (r) => r.value?.result?.printed;
const msgs = (r) => JSON.stringify((r.diagnostics ?? []).map((d) => d.code + ": " + d.message));

// 1. Policy functions (evaluation)
t("policy typechecks", forma("typecheck", "src/policy.forma").ok);
t("policy tests typecheck", forma("typecheck", "tests/policy-test.forma").ok, msgs(forma("typecheck", "tests/policy-test.forma")));
const ev = forma("evaluate", "tests/policy-test.forma");
t("policy tests: no failing cases", ev.ok && printed(ev) === "[]", printed(ev) ?? msgs(ev));

// 2. Mutation: a wrong expectation must make the suite fail.
const src = readFileSync(join(root, "tests/policy-test.forma"), "utf8");
const mutant = "tests/policy-test.mutant.forma";
writeFileSync(join(root, mutant), src.replace(
  '(is "exception from non-CISO is invalid" (exception-valid? (ex :security-analyst "ok" 950) today) false)',
  '(is "exception from non-CISO is invalid" (exception-valid? (ex :security-analyst "ok" 950) today) true)'));
const mv = forma("evaluate", mutant);
rmSync(join(root, mutant));
t("mutant suite reports the flipped case", printed(mv) === '["exception from non-CISO is invalid"]', printed(mv));

// 3. Vendor register language (elaboration)
const good = forma("declarations", "src/register.forma");
t("register elaborates without diagnostics", good.ok && good.diagnostics.length === 0, msgs(good));
const bad = forma("declarations", "tests/fixtures/register-bad.forma");
t("bad register is rejected with vendor/active-without-review",
  !bad.ok && bad.diagnostics.some((d) => d.code === "vendor/active-without-review"), msgs(bad));

// 4. Pinned silent traps (these assert CURRENT behaviour, which is surprising)
t("TRAP: `file evaluate` runs an ill-typed program", forma("evaluate", "tests/traps/evaluate-skips-typecheck.forma").ok
  && !forma("typecheck", "tests/traps/evaluate-skips-typecheck.forma").ok);
t("TRAP: bad register reports only the first of 3 violations", bad.diagnostics.length === 1, String(bad.diagnostics.length));
t("FIXED T2: generic fn used in two top-level defines typechecks", forma("typecheck", "tests/traps/generic-across-defines.forma").ok);
t("FIXED T3: implicit Some-wrapping works for an imported record type", forma("typecheck", "tests/traps/imported-option-wrap.forma").ok);
const wrapped = forma("evaluate", "tests/traps/imported-option-wrap.forma");
t("FIXED F10: dot access on an imported-typed binding evaluates, with Some/None filled",
  printed(wrapped) === '[{:_tag "Some" :value 2} {:_tag "None"}]', printed(wrapped) ?? msgs(wrapped));
t("TRAP: imported fn with inner lambda is nil inside a form :check",
  /Cannot call nil/.test(msgs(forma("declarations", "tests/traps/hook-import/use.forma"))));
t("TRAP: register's own vendor IR is absent from `file declarations`",
  !good.value.some((d) => d.payload?.kind === "Vendor"));

console.log(failed ? `\n${failed} failed` : "\nall passed");
process.exit(failed ? 1 : 0);
