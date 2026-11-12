(export ticket-price sample)
(: ticket-price (-> Int Int Int))
(define ticket-price [age quantity]
  (let [base (if (< age 18) 8 (if (< age 65) 12 6))]
    (* quantity (if (>= quantity 10) (- base 2) base))))
(define sample (ticket-price 30 10))
