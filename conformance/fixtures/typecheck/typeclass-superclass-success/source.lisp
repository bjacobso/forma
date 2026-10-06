(typeclass (Eq a) (: eq (-> a a Bool)))
(typeclass (Ord a) :extends [(Eq a)]
  (: compare (-> a a Number)))
(compare 1 2)
