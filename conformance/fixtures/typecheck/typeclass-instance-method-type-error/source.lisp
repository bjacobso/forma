(typeclass (Show a) (: show (-> a String)))
(instance (Show Num)
  (define show  [x] 42))
