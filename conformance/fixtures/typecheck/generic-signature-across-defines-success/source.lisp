;; An explicit generic signature is instantiated afresh at each use.
(: same (-> a a Bool))
(define same [x y] (= x y))
(define a (same 1 1))
(define b (same "a" "b"))
(define c (same [1] [2]))
(= a (= b c))
