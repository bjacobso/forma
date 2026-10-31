;; An inline implement follows the layer rules, and is valid only as the layer
;; argument of provide.
(error NotFound {:key String})
(error Corrupt {:key String})
(service Store
  (: get (-> String (Effect String [NotFound] [])))
  (: set (-> String String (Effect Unit [] []))))
(service Clock (: now (-> Unit (Effect Int [] []))))
(: read (-> String (Effect String [NotFound] [Store.get])))
(define read [key] (Store.get key))
(: missing-member (-> String (Effect String [NotFound] [])))
(define missing-member [key] (provide (read key) (implement Store (define get [k] (succeed k)))))
(: unknown-member (-> String (Effect String [NotFound] [])))
(define
  unknown-member
  [key]
  (provide
    (read key)
    (implement
      Store
      (define get [k] (succeed k))
      (define set [k v] (succeed nil))
      (define delete [k] (succeed nil)))))
(: duplicate-member (-> String (Effect String [NotFound] [])))
(define
  duplicate-member
  [key]
  (provide
    (read key)
    (implement
      Store
      (define get [k] (succeed k))
      (define get [k] (succeed "again"))
      (define set [k v] (succeed nil)))))
(: undeclared-error (-> String (Effect String [NotFound] [])))
(define
  undeclared-error
  [key]
  (provide
    (read key)
    (implement Store (define get [k] (fail (Corrupt {:key k}))) (define set [k v] (succeed nil)))))
(: self-call (-> String (Effect String [NotFound] [])))
(define
  self-call
  [key]
  (provide
    (read key)
    (implement Store (define get [k] (succeed k)) (define set [k v] (Store.set k v)))))
(: unused-provider (-> String (Effect Int [] [Clock.now])))
(define
  unused-provider
  [key]
  (provide
    (Clock.now nil)
    (implement Store (define get [k] (succeed k)) (define set [k v] (succeed nil)))))
(: stored (-> String (Effect String [NotFound] [])))
(define
  stored
  [key]
  (do!
    [:let [store-layer (implement Store (define get [k] (succeed k)) (define set [k v] (succeed nil)))]]
    (provide (read key) store-layer)))
