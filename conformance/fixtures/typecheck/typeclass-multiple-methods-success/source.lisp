(typeclass (Show a) (: show (-> a String))
  (: show-list (-> (List a) String)))
(show 42)
