(define-schema OrderId (Brand OrderId String))

(define-schema Status (Enum pending paid shipped))

(define-schema Order
  (Struct
    (field id OrderId)
    (field status Status)
    (field total-cents Int)))

(define-error OrderNotFound (:fields (field id OrderId)))
(define-error PaymentDeclined (:fields (field reason String)))

(define-service Orders
  (:methods
    (find [id OrderId] (Effect (Option Order) [] []))
    (save [order Order] (Effect Unit [] []))))

(define-service Payments
  (:methods
    (charge [cents Int] (Effect String [PaymentDeclined] []))))

(: pay (-> OrderId (Effect Order [OrderNotFound] [Orders Payments.charge])))
(define-operation pay [id]
  (do! [found (Orders.find id)]
    (match found
      none (fail (OrderNotFound {:id id}))
      (some order)
        (do! [_ (retry (Payments.charge (get order :total-cents)) :times 2)
              paid (succeed (assoc order :status "paid"))
              _ (Orders.save paid)]
          (succeed paid)))))
