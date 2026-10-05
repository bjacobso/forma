;; Unknown functions, services, and types are located precisely.
(: total (-> (Array Int) (Effect Int [] [])))
(define-operation total [items]
  (succeed (summ items)))

(: lookup (-> String (Effect Customer [] [Customers.find])))
(define-operation lookup [id]
  (Customers.find id))
