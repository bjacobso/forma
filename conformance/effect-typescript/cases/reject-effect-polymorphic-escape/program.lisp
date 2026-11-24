;; A rigid set variable cannot be dropped: the body calls f, so the result
;; must declare e and r. `declined` is not silently a variable either.
(error Declined {:reason String})
(service Stripe (: charge (-> Int (Effect String [Declined] []))))

(: leaky (-> (-> Int (Effect a [e] [r])) Int (Effect a [] [])))
(define leaky [f n] (f n))

(: unsolvable (-> Int (Effect Int [declined] [])))
(define unsolvable [n] (succeed n))

(: kinds (-> (-> Int (Effect a [e] [e])) Int (Effect a [e] [e])))
(define kinds [f n] (f n))
