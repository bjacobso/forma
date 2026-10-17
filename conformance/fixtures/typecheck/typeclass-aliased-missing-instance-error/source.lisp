(typeclass (Eq a) (: eq (-> a a Bool)))
(instance (Eq Float) (define eq [a b] (= a b)))
(define same eq)
(same (fn [n] n) (fn [n] n))
