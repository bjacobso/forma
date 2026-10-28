; extern binds a hand-written TypeScript module: a branded id, a schema, a
; tagged error, a service with its live layer, pure functions (one renamed),
; a constant, and an operation. Forma checks every use against the declared
; types; TypeScript checks the declarations against the module's exports.
(extern "./payments.js"
  (type OrderId (Brand String))
  (type Receipt {:order OrderId :cents Int})
  (error PaymentDeclined {:reason String})
  (service Payments
    (: charge (-> OrderId Int (Effect Receipt [PaymentDeclined]))))
  (: PaymentsLive (Layer [Payments]))
  (: format-cents (-> Int String))
  (: slug (-> String String) :export "toSlug")
  (: currency String)
  (: audit (-> String (Effect Unit))))

(type Order {:id OrderId :cents Int})

(: pay (-> Order (Effect String [PaymentDeclined] [Payments.charge])))
(define pay [order]
  (do! [receipt (Payments.charge (get order :id) (get order :cents))
        _ (audit (str "charged " (slug (get order :id))))]
    (str (format-cents (get receipt :cents)) " " currency)))

(: checkout (-> Order (Effect String)))
(define checkout [order]
  (provide
    (catch (pay order)
      (PaymentDeclined e) (succeed (str "declined: " (get e :reason))))
    PaymentsLive))
