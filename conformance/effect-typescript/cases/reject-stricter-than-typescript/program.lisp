;; Checks TypeScript would accept but that hide bugs: comparing records by
;; reference, interpolating records into strings, JavaScript truthiness, and
;; storing a fractional result in an Int.
(define-schema Money (Struct (field amount Int) (field currency String)))

(: same-price (-> Money Money (Effect Bool [] [])))
(define-operation same-price [left right]
  (succeed (= left right)))

(: label (-> Money (Effect String [] [])))
(define-operation label [price]
  (succeed (str "price: " price)))

(: check-currency (-> Money (Effect String [] [])))
(define-operation check-currency [price]
  (if (get price :amount)
    (succeed "non-zero")
    (succeed "zero")))

(: halve (-> Int (Effect Int [] [])))
(define-operation halve [n]
  (succeed (/ n 2)))
