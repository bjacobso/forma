;; A generic function stays generic in each later top-level definition.
(define same [x y] (= x y))
(define a (same 1 1))
(define b (same "a" "b"))
(= a b)
