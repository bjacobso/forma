import { rejectedAt } from "../../hard-support.mjs";
import { acceptProgram } from "../../accept-support.mjs";

export async function accept(dir) {
  const result = await acceptProgram(dir, `(import "./main.lisp" [Tier Invoice Summary net-amount tier-surcharge format-label summarize])
(= {:nums [(net-amount {:id "a" :subtotal 1000 :discount 150 :tier :standard :note None})
           (net-amount {:id "b" :subtotal 500 :discount -40 :tier :standard :note None})
           (net-amount {:id "c" :subtotal 100 :discount 250 :tier :priority :note None})
           (net-amount {:id "d" :subtotal -20 :discount 0 :tier :priority :note None})
           (tier-surcharge :standard 1000)
           (tier-surcharge :priority 0)
           (tier-surcharge :priority -10)
           (tier-surcharge :priority 1000)
           (tier-surcharge :priority 99)]
    :labels [(format-label None)
             (format-label (Some "   "))
             (format-label (Some "  rush  "))]}
   {:nums [850 500 0 0 0 0 0 350 259]
    :labels ["unlabeled" "unlabeled" "rush"]})`);
  const summary = await acceptProgram(dir, `(import "./main.lisp" [summarize])
(= [(summarize {:id "inv-1" :subtotal 1000 :discount 100 :tier :priority :note (Some " Q1 ")})
    (summarize {:id "inv-2" :subtotal 200 :discount 500 :tier :priority :note (Some " ")})
    (summarize {:id "inv-3" :subtotal 400 :discount -50 :tier :standard :note None})]
   [{:id "inv-1" :net 900 :surcharge 340 :total 1240 :label "Q1"}
    {:id "inv-2" :net 0 :surcharge 0 :total 0 :label "unlabeled"}
    {:id "inv-3" :net 400 :surcharge 0 :total 400 :label "unlabeled"}])`);
  result.reasons.push(...summary.reasons);
  result.reasons.push(...await rejectedAt(dir, `(import "./main.lisp" [summarize])
(summarize {:id "bad" :subtotal 10.5 :discount 0 :tier :standard :note None})`, [{ code: "typecheck/type-mismatch", token: "10.5" }], "typecheck"));
  result.reasons.push(...await rejectedAt(dir, `(import "./main.lisp" [tier-surcharge])
(tier-surcharge :rush 100)`, [{ code: "typecheck/type-mismatch", token: ":rush" }], "typecheck"));
  return { pass: result.reasons.length === 0, reasons: result.reasons };
}
