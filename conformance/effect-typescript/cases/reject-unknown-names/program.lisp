;; Unknown functions, services, and types are located precisely.
(: total (-> (List Int) (Effect Int [] [])))
(define total [items]
  (succeed (summ items)))

(: lookup (-> String (Effect Customer [] [Customers.find])))
(define lookup [id]
  (Customers.find id))
