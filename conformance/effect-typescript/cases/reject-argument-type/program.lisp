;; Service arguments and record fields are checked against their schemas.
(define-schema Order
  (Struct
    (field id String)
    (field quantity Int)))

(define-service Orders
  (:methods
    (place [order Order] (Effect String [] []))
    (cancel [id String] (Effect Unit [] []))))

(: place-and-cancel (-> Int (Effect Unit [] [Orders])))
(define-operation place-and-cancel [quantity]
  (do! [id (Orders.place {:id "o-1" :quantity "three"})]
    (Orders.cancel quantity)))
