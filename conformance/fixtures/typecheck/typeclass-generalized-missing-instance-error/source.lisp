(typeclass (Eq a) (: eq (-> a a Bool)))
(instance (Eq Float) (define eq [a b] (= a b)))
(define equals [x y] (eq x y))
(equals (fn [n] n) (fn [n] n))
