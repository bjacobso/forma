import { readFile } from "node:fs/promises";
import { forma, probe, detail } from "../../accept-support.mjs";
export async function accept(dir) {
  const reasons = [];
  const policy = await probe(dir, await readFile(new URL("./policy-cases.lisp", import.meta.url), "utf8"));
  if (!policy.ok || policy.value?.result?.printed !== "[]") reasons.push(`policy cases: ${policy.value?.result?.printed ?? detail(policy)}`);
  const good = forma(dir, "declarations", "main.lisp");
  const vendors = good.ok ? good.value.filter(d => d.summary?.kind === "FormApplication" && d.payload?.kind === "Vendor") : [];
  if (!good.ok || !vendors.some(d => d.payload.status === "active" && d.payload.blockers.length === 0) ||
      !vendors.some(d => d.payload.status === "proposed" && d.payload.blockers.length > 0)) reasons.push(`register must project valid active and blocked proposed vendors: ${detail(good)}`);
  const bad = await probe(dir, await readFile(new URL("./register-invalid.lisp", import.meta.url), "utf8"), "declarations");
  if (bad.ok || bad.diagnostics.filter(d => d.code === "vendor/active-without-review").length !== 3) reasons.push(`three invalid active vendors must be rejected: ${detail(bad)}`);
  return {pass: reasons.length === 0, reasons};
}
