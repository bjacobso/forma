(typeclass (Eq a) (: eq (-> a a Bool)))
(instance (Eq Int)
  (define eq  [a b] (= a b)))
(eq 1 2)
