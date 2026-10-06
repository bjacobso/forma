(typeclass (Functor (f : (-> * *))) (: fmap (-> (-> a b) (f a) (f b))))
(instance (Functor List)
  (define fmap  [f xs] (map f xs)))
(fmap (fn [x] (+ x 1)) [1 2 3])
