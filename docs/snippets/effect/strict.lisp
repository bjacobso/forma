(define-schema Money
  (Struct
    (field amount Int)
    (field currency String)))

(: same-price? (-> Money Money Bool))
(define same-price? (fn [a b] (= a b)))

(: label (-> Money String))
(define label (fn [price] (str "price: " price)))

(: half (-> Int Int))
(define half (fn [n] (/ n 2)))

(: describe (-> Int String))
(define describe (fn [count] (if count "some" "none")))
