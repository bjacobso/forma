;; Success values are checked against the signature in every branch.
(define-schema Invoice
  (Struct
    (field id String)
    (field total-cents Int)))

(define-service Invoices
  (:methods
    (load [id String] (Effect Invoice [] []))))

(: total (-> String (Effect Int [] [Invoices.load])))
(define-operation total [id]
  (do! [invoice (Invoices.load id)]
    (if (> (get invoice :total-cents) 0)
      (succeed (get invoice :total-cents))
      (succeed "free"))))

(: invoice-id (-> String (Effect Int [] [Invoices.load])))
(define-operation invoice-id [id]
  (do! [invoice (Invoices.load id)]
    (succeed (get invoice :id))))
