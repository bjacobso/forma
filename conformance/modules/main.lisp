(import "./state.lisp" :as state)
(import "./identity.lisp" [identity])
(import "./ids.lisp" :as ids)
(import "./log.lisp" [log Console])
(export main)
(: main (Effect String [] [Console.print]))
(define main
  (log (ids/make-customer (ids/CustomerId (identity "1")) (state/label (state/Status.Ready {:message (identity "Ada")})))))

(define inferred-int (identity 42))
