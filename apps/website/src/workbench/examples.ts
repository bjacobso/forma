import { ordersSource, ordersUndeclaredSource, strictSource } from "../effectPageSources";
import { contractSource, undeclaredCapabilitySource } from "../pipelines/sources";
import { getPipeline } from "../pipelines";
import type { EnginePassName } from "../engine/protocol";

export interface WorkbenchExample {
  id: string;
  title: string;
  file: string;
  source: string;
  broken: string;
  prompt: string;
  dialect?: "effect";
  passes: readonly EnginePassName[];
}

export const workbenchExamples: readonly WorkbenchExample[] = [
  { id: "contracts", title: "Effect contracts", file: "log.forma", source: contractSource,
    broken: undeclaredCapabilitySource, prompt: "Remove Console.print from the signature. The body still needs it.",
    dialect: "effect", passes: ["parse", "typecheck"] },
  { id: "orders", title: "Order payments", file: "orders.forma", source: ordersSource,
    broken: ordersUndeclaredSource, prompt: "Remove PaymentDeclined from the signature. Watch the compiler find the call that can fail.",
    dialect: "effect", passes: ["parse", "typecheck"] },
  { id: "inference", title: "Type inference", file: "price.forma",
    source: '(fn [order]\n  (+ (get order :subtotal) (get order :tax)))',
    broken: '(fn [order]\n  (+ (get order :subtotal) "oops"))',
    prompt: 'Replace a numeric field with "oops". Inference follows the body.', passes: ["parse", "expand", "typecheck"] },
  { id: "macros", title: "Macros → values", file: "grades.forma", source: getPipeline("full-pipeline").source,
    broken: getPipeline("full-pipeline").source.replace('(>= score 90)', '(>= score "90")'),
    prompt: "Change the grade thresholds. See cond expand into the core and the result update.",
    passes: ["parse", "expand", "typecheck", "evaluate"] },
  { id: "strict", title: "Stricter checks", file: "strict.forma", source: strictSource,
    broken: strictSource, prompt: "Four mistakes: reference equality, object interpolation, fractional Int, and truthiness. Click a diagnostic to jump to its source.",
    dialect: "effect", passes: ["parse", "typecheck"] },
];

/** A small authored edit: delete the differing text, pause on diagnostics, type the repair. */
export function typingEdit(valid: string, broken: string) {
  let from = 0;
  while (from < valid.length && from < broken.length && valid[from] === broken[from]) from++;
  let suffix = 0;
  while (suffix < valid.length - from && suffix < broken.length - from && valid[valid.length - suffix - 1] === broken[broken.length - suffix - 1]) suffix++;
  return { from, validEnd: valid.length - suffix, brokenEnd: broken.length - suffix,
    prefix: valid.slice(0, from), suffix: suffix ? valid.slice(-suffix) : "",
    repair: valid.slice(from, valid.length - suffix), mistake: broken.slice(from, broken.length - suffix) };
}
