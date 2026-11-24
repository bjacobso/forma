;; RFC 0023: a wrapper over two callbacks unions their sets with [e1 e2] and
;; [r1 r2]; an effect-free pair still needs no capabilities.
(error NotFound {:key String})
(error Timeout)
(service Store (: get (-> String (Effect String [NotFound] []))))
(service Cache (: peek (-> String (Effect String [Timeout] []))))

(: from-store (-> String (Effect String [NotFound] [Store.get])))
(define from-store [key] (Store.get key))

(: from-cache (-> String (Effect String [Timeout] [Cache.peek])))
(define from-cache [key] (Cache.peek key))

(: constant (-> String (Effect String)))
(define constant [key] (succeed (str "const-" key)))

(: first-of
  (-> (-> String (Effect a [e1] [r1])) (-> String (Effect a [e2] [r2])) String
      (Effect a [e1 e2] [r1 r2])))
(define first-of [left right key]
  (do! [l (left key)
        _ (right key)]
    l))

(: both (-> String (Effect String [NotFound Timeout] [Store.get Cache.peek])))
(define both [key] (first-of from-store from-cache key))

(: store-and-constant (-> String (Effect String [NotFound] [Store.get])))
(define store-and-constant [key] (first-of from-store constant key))

(: constants (-> String (Effect String)))
(define constants [key] (first-of constant constant key))
