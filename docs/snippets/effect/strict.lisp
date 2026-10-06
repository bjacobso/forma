(type Money {:amount Int
 :currency String})

(: same-price? (-> Money Money Bool))
(define same-price?  [a b] (= a b))

(: label (-> Money String))
(define label  [price] (str "price: " price))

(: half (-> Int Int))
(define half  [n] (/ n 2))

(: describe (-> Int String))
(define describe  [count] (if count "some" "none"))
