;; Shared contract: a local binding shadowing an outer Int with a String must be
;; rejected where Int is expected, rather than leaking the outer binding's type.
(: outer Int)
(define outer 10)

(: bad-shadow (-> String Int))
(define bad-shadow [x]
  (let [outer x]
    outer))
