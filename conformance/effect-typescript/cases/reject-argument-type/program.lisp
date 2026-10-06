;; Service arguments and record fields are checked against their schemas.
(type Order {:id String
 :quantity Int})

(service Orders
  (: place (-> Order (Effect String [] [])))
  (: cancel (-> String (Effect Unit [] []))))

(: place-and-cancel (-> Int (Effect Unit [] [Orders])))
(define place-and-cancel [quantity]
  (do! [id (Orders.place {:id "o-1" :quantity "three"})]
    (Orders.cancel quantity)))
