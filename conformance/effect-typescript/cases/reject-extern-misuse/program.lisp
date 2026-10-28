; Uses of imported declarations are checked like local ones: an imported
; operation's failure must be declared, and an imported function's argument
; must have its declared type. The module is the extern-interop case's.
(extern "../extern-interop/payments.js"
  (type OrderId (Brand String))
  (type Receipt {:order OrderId :cents Int})
  (error PaymentDeclined {:reason String})
  (service Payments
    (: charge (-> OrderId Int (Effect Receipt [PaymentDeclined]))))
  (: format-cents (-> Int String)))

(: pay (-> OrderId Int (Effect String [] [Payments.charge])))
(define pay [id cents]
  (do! [receipt (Payments.charge id cents)]
    (format-cents (str (get receipt :cents)))))
