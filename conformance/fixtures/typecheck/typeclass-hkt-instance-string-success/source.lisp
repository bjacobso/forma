(typeclass (Functor (f : (-> * *))) (: fmap (-> (-> a b) (f a) (f b))))
(instance (Functor List)
  (define fmap  [f xs] (map f xs)))
(fmap (fn [x] (concat "" "")) [1 2 3])
