import { acceptProgram } from "../../accept-support.mjs";
const cases = dir => acceptProgram(dir, `(import "./main.lisp" [Role Event Summary identity same required summarize amounts])
(: expected (List Role))
(define expected [:manager :finance])
(define ints (same 2 2))
(define words (same "x" "x"))
(: events (List Event))
(define events [(Event.Charge {:cents 8000 :role :manager}) Event.Void
 (Event.Refund {:cents 120}) (Event.Charge {:cents 20 :role :finance})])
(: s Summary)
(define s (identity (summarize (identity events))))
(= [ints words (same (required 250001) (identity expected))
 (same (required 7500) []) (same (required 7501) [:manager])
 (= s.net 7900) (= s.charges 2) (same s.roles expected)
 (= (amounts events) [8000 0 -120 20]) (= (get (summarize []) :net) 0)]
 [true true true true true true true true true true])`, [{"source": "(import \"./main.lisp\" [Role identity])\n(: bad (List Role))\n(define bad (identity [:owner]))", "code": "typecheck/type-mismatch"}]);

import { rejectedAt } from "../../hard-support.mjs";
export async function accept(dir) {
 const result = await cases(dir);
 result.reasons.push(...await rejectedAt(dir, "(import \"./main.lisp\" [Role identity])\n(: bad (List Role))\n(define bad (identity [:owner]))", [{code:"typecheck/type-mismatch",token:"(identity [:owner])"}], "typecheck"));
 return {pass:result.reasons.length===0,reasons:result.reasons};
}
