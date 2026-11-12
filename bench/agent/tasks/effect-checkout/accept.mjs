import { checkoutBehavior } from "../../effect-behavior.mjs";
import { forma, probe, detail } from "../../accept-support.mjs";
import { rejectedAt } from "../../hard-support.mjs";
export async function accept(dir) {
 const reasons = [];
 const good = forma(dir, "declarations", "main.lisp");
 if (!good.ok) reasons.push(`Effect contracts: ${detail(good)}`);
 else { try { await checkoutBehavior(good.value); } catch (error) { reasons.push(`Effect behavior: ${error.message}`); } }
 const valid = await probe(dir, `(import "./main.lisp" [Receipt Declined Payments Audit checkout retry-free preview])
(: caller (-> String Int (Effect Receipt [] [Payments.charge Audit.record])))
(define caller [id n] (retry-free id n))`, "declarations");
 if (!valid.ok) reasons.push(`public contracts: ${detail(valid)}`);
 reasons.push(...await rejectedAt(dir, `(import "./main.lisp" [Receipt Declined Payments Audit checkout])
(: missing-audit (-> String Int (Effect Receipt [Declined] [Payments.charge])))
(define missing-audit [id n] (checkout id n))`, [{code:"mechanics/undeclared-requirement",token:"(checkout id n)"}]));
 reasons.push(...await rejectedAt(dir, `(import "./main.lisp" [Receipt Declined Payments Audit checkout])
(: missing-error (-> String Int (Effect Receipt [] [Payments.charge Audit.record])))
(define missing-error [id n] (checkout id n))`, [{code:"mechanics/undeclared-error",token:"(checkout id n)"}]));
 return {pass:reasons.length===0,reasons};
}
