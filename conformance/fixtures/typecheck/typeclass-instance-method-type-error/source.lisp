(typeclass (Show a) (: show (-> a String)))
(instance (Show Float)
  (define show  [x] 42))
