(: same (-> a a Bool))
(define same [x y] (= x y))
(define a (same 1 1))
(define b (same "a" "b"))
[a b]
