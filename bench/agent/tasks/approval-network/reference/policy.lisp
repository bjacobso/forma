(import "./types.lisp" [Facts Decision])
(import "./calendar.lisp" [current? due])
(export decide)
(: decide (-> Facts Decision))
(define decide [f]
 (let [why (if (< f.amount 0) "negative"
            (if (= (trim f.reason) "") "reason"
             (if (current? f.approved-on f.as-of)
              (if (> f.amount 250000) (if (= f.role "finance") "ok" "finance") "ok") "expired")))]
  {:allowed (= why "ok") :due (due f.approved-on) :reason why}))
