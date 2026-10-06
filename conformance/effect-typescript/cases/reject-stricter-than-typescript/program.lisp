;; Checks TypeScript would accept but that hide bugs: comparing records by
;; reference, interpolating records into strings, JavaScript truthiness, and
;; storing a fractional result in an Int.
(type Money {:amount Int
 :currency String})

(: same-price (-> Money Money (Effect Bool [] [])))
(define same-price [left right]
  (succeed (= left right)))

(: label (-> Money (Effect String [] [])))
(define label [price]
  (succeed (str "price: " price)))

(: check-currency (-> Money (Effect String [] [])))
(define check-currency [price]
  (if (get price :amount)
    (succeed "non-zero")
    (succeed "zero")))

(: halve (-> Int (Effect Int [] [])))
(define halve [n]
  (succeed (/ n 2)))
