;; Success values are checked against the signature in every branch.
(type Invoice {:id String
 :total-cents Int})

(service Invoices
  (: load (-> String (Effect Invoice [] []))))

(: total (-> String (Effect Int [] [Invoices.load])))
(define total [id]
  (do! [invoice (Invoices.load id)]
    (if (> (get invoice :total-cents) 0)
      (succeed (get invoice :total-cents))
      (succeed "free"))))

(: invoice-id (-> String (Effect Int [] [Invoices.load])))
(define invoice-id [id]
  (do! [invoice (Invoices.load id)]
    (succeed (get invoice :id))))
