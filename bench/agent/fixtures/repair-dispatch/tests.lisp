(import "./main.lisp" [base price dispatch State])
(= [(= (base 1000) 500) (= (base 1001) 700)
 (= (price {:grams 2000 :mode :express :destination None}) 1500)
 (= (dispatch {:grams 1 :mode :standard :destination (Some "Oslo")}) (State.Ready {:cost 500}))]
 [true true true true])
