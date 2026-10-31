(type OrderId (Brand String))

(type Status (Union :pending :paid :shipped))

(type Order {:id OrderId
 :status Status
 :total-cents Int})

(error OrderNotFound {:id OrderId})
(error PaymentDeclined {:reason String})

(service Orders
  (: find (-> OrderId (Effect (Option Order) [] [])))
  (: save (-> Order (Effect Unit [] []))))

(service Payments
  (: charge (-> Int (Effect String [PaymentDeclined] []))))

(: pay (-> OrderId (Effect Order [OrderNotFound] [Orders Payments.charge])))
(define pay [id]
  (do! [found (Orders.find id)]
    (match found
      None (fail (OrderNotFound {:id id}))
      (Some order)
        (let [paid (assoc order :status "paid")]
          (retry (Payments.charge (get order :total-cents)) :times 2)
          (Orders.save paid)
          paid))))
