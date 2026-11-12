import { acceptProgram, probe } from "../../accept-support.mjs";
const cases = dir => acceptProgram(dir, `(import "./main.lisp" [invoice line-tax aggregate moving])
(= [(= (invoice [{:cents 1 :quantity 1 :tax-bps 5000} {:cents 1 :quantity 1 :tax-bps 5000}]) {:net 2 :tax 2 :gross 4})
 (= (line-tax {:cents -1 :quantity 1 :tax-bps 5000}) -1)
 (= (line-tax {:cents 99 :quantity 3 :tax-bps 825}) 25)
 (= (invoice []) {:net 0 :tax 0 :gross 0})
 (= (aggregate [{:elapsed 2.0 :units 6} {:elapsed 1.0 :units 3}]) {:elapsed 3.0 :units 9 :rate 3.0})
 (= (aggregate []) {:elapsed 0.0 :units 0 :rate 0.0})
 (= (moving 0.0 [4.0 4.0 4.0]) [1.0 1.75 2.3125])]
 [true true true true true true true])`, [{"source": "(import \"./main.lisp\" [subtotal])\n(subtotal {:cents 1.0 :quantity 2 :tax-bps 0})", "code": "typecheck/type-mismatch"}]);

import { rejectedAt } from "../../hard-support.mjs";
export async function accept(dir) {
 const result = await cases(dir);
 const kinds = await probe(dir, `(import "./main.lisp" [invoice aggregate moving])
 [(get (invoice [{:cents 3 :quantity 2 :tax-bps 5000}]) :net)
  (get (invoice [{:cents 3 :quantity 2 :tax-bps 5000}]) :tax)
  (get (aggregate [{:elapsed 2.0 :units 4}]) :elapsed)
  (get (aggregate [{:elapsed 2.0 :units 4}]) :units)
  (get (aggregate [{:elapsed 2.0 :units 4}]) :rate)
  (first (moving 0.0 [4.0]))]`);
 const actual = kinds.value?.result?.value?.items?.map(v => v.kind);
 if (JSON.stringify(actual) !== JSON.stringify(["int","int","float","int","float","float"])) {
  result.reasons.push(`runtime numeric kinds: ${JSON.stringify(actual)}`);
 }
 result.reasons.push(...await rejectedAt(dir, `(import "./main.lisp" [subtotal])
(subtotal {:cents 1.0 :quantity 2 :tax-bps 0})`, [{code:"typecheck/type-mismatch",token:"1.0"}], "typecheck"));
 return {pass:result.reasons.length===0,reasons:result.reasons};
}
