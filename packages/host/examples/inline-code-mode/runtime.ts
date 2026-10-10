// Node-only catalog loading stays outside the browser-neutral experiment API.
import { readFileSync } from "node:fs";
import { compileCatalog, effectEvidence as evidence, ExecutionSession as Session } from "@formalang/host/inline-code-mode";
import type { Bindings, Budgets } from "@formalang/host/inline-code-mode";
export { defaults } from "@formalang/host/inline-code-mode";
export type { Bindings, Budgets, ExecutionResult } from "@formalang/host/inline-code-mode";

const catalog = compileCatalog(readFileSync(new URL("./catalog.forma", import.meta.url), "utf8"));
export const contracts = catalog.contracts;
export const effectEvidence = () => evidence(catalog,
  readFileSync(new URL("./summary-effect.forma", import.meta.url), "utf8"));

export class ExecutionSession extends Session {
  constructor(bindings: Bindings, allow?: ReadonlySet<string>, budgets?: Budgets) {
    super(catalog, bindings, allow, budgets);
  }
}
