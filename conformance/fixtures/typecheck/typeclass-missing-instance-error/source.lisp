(typeclass (Eq a) (: eq (-> a a Bool)))
(instance (Eq Float)
  (define eq  [a b] (= a b)))
(eq "a" "b")
