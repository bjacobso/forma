import { acceptProgram } from "../../accept-support.mjs";
const cases = dir => acceptProgram(dir, `(import "./main.lisp" [Member label credit reachable? reconcile])
(: empty Member)
(define empty {:name "Nobody"})
(: city Member)
(define city {:name "Ada" :contact {:address {:city " Oslo " :unit " 4 "}} :credits 9})
(: blank Member)
(define blank {:name "Fallback" :contact {:email "  " :address {:city "  "}} :credits -3})
(= [(= (label empty) "Nobody") (= (label city) "Oslo / 4") (= (label blank) "Fallback")
 (= (label {:name "Inline" :contact (Some {:email (Some " x@y ") :address None}) :credits None}) "x@y")
 (= (reconcile [empty city blank]) {:labels ["Nobody" "Oslo / 4" "Fallback"] :credits 9 :reachable 1})
 (= (reachable? blank) false) (= (credit city) 9)] [true true true true true true true])`, []);

import { rejectedAt } from "../../hard-support.mjs";
export async function accept(dir) {
 const result = await cases(dir);
 result.reasons.push(...await rejectedAt(dir, "(import \"./main.lisp\" [credit])\n(credit {:name \"x\" :credits \"bad\"})", [{code:"typecheck/type-mismatch",token:"\"bad\""}], "typecheck"));
 return {pass:result.reasons.length===0,reasons:result.reasons};
}
