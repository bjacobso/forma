;; An always-true cond clause must come last.
(: classify (-> Int (Effect String [] [])))
(define-operation classify [n]
  (cond
    (< n 0) (succeed "negative")
    :else (succeed "other")
    (= n 0) (succeed "zero")))
