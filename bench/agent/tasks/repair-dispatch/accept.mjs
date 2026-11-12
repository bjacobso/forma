import { rejectedAt } from "../../hard-support.mjs";
import { acceptProgram, forma, detail } from "../../accept-support.mjs";
export async function accept(dir) {
 const result = await acceptProgram(dir, `(import "./main.lisp" [Mode Parcel State base price dispatch])
(= [(base -1) (base 0) (base 1) (base 999) (base 1000) (base 1001) (base 2000) (base 2001)
 (price {:grams 0 :mode :express :destination None})
 (price {:grams 1 :mode :express :destination None})]
 [0 0 500 500 500 700 700 900 0 1300])`);
 const tests = forma(dir, "evaluate", "tests.lisp");
 if (!tests.ok || tests.value.result.printed !== "true") result.reasons.push(`provided tests: ${detail(tests)}`);
 const states = await acceptProgram(dir, `(import "./main.lisp" [dispatch State])
(= [(dispatch {:grams 0 :mode :standard :destination (Some "X")})
 (dispatch {:grams 5 :mode :express :destination None})
 (dispatch {:grams 5 :mode :standard :destination (Some "  ")})
 (dispatch {:grams 2001 :mode :standard :destination (Some "Y")})]
 [(State.Blocked {:reason "weight"}) (State.Blocked {:reason "destination"})
 (State.Blocked {:reason "destination"}) (State.Ready {:cost 900})])`);
 result.reasons.push(...states.reasons);
 result.reasons.push(...await rejectedAt(dir, `(import "./main.lisp" [price])
(price {:grams 1.0 :mode :express :destination None})`, [{code:"typecheck/type-mismatch",token:"1.0"}], "typecheck"));
 return {pass:result.reasons.length===0,reasons:result.reasons};
}
