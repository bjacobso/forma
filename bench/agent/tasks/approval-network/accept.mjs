import { acceptProgram } from "../../accept-support.mjs";
import { entryForms, projected, rejectedAt } from "../../hard-support.mjs";
export async function accept(dir) {
 const behavior = await acceptProgram(dir, `(import "./policy.lisp" [decide])
 (= [(get (decide {:amount -1 :role "finance" :approved-on 0 :as-of 999 :reason ""}) :reason)
 (get (decide {:amount 0 :role "manager" :approved-on 100 :as-of 99 :reason "ok"}) :reason)
 (get (decide {:amount 250000 :role "manager" :approved-on 100 :as-of 281 :reason " ok "}) :reason)
 (get (decide {:amount 250001 :role "manager" :approved-on 100 :as-of 281 :reason "ok"}) :reason)
 (get (decide {:amount 0 :role "ciso" :approved-on 100 :as-of 100 :reason "  "}) :reason)]
 ["negative" "expired" "ok" "finance" "reason"])`);
 const reasons = [...behavior.reasons, ...entryForms(dir, "Approval", 3)];
 reasons.push(...await projected(dir, `(import "./forms.lisp" [approval])
(approval edge :amount 0 :role "ciso" :approved-on 40 :as-of 221 :reason "yes" :status "active")
(approval later :amount 0 :role "manager" :approved-on 40 :as-of 222 :reason "yes" :status "draft")`,
 [{kind:"Approval",name:"edge",status:"active",allowed:true,due:222,reason:"ok"},
 {kind:"Approval",name:"later",status:"draft",allowed:false,due:222,reason:"expired"}]));
 reasons.push(...await rejectedAt(dir, `(import "./forms.lisp" [approval])
(approval valid :amount 1 :role "manager" :approved-on 0 :as-of 0 :reason "x" :status "active")
(approval old :amount 1 :role "finance" :approved-on 0 :as-of 182 :reason "x" :status
 "active")
(approval expensive :amount 250001 :role "manager" :approved-on 0 :as-of 0 :reason "x" :status
   "active")`, [{code:"approval/blocked",token:'"active")\n(approval expensive'}, {code:"approval/blocked",token:'"active")',last:true}]));
 return {pass:reasons.length===0,reasons};
}
