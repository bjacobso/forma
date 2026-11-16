;; Defect's checkout example, written as ordinary sequential steps with
;; forma:effect (RFC 0029 stage 1). Each bind runs an effect and names its
;; value; let names a pure value; _ discards a value but keeps its effects.
;; The checker infers the body's errors and requirements and holds them to the
;; signature. The same program written with do! generates identical code.
(import "forma:effect" [do bind pure])
(type CartId (Brand String))
(type Email (Brand String))
(type Item {:sku String :price Int})
(type Cart {:id CartId :items (List Item)})
(type Payment {:receipt-id String :amount Int})
(type CheckoutReceipt {:receipt String :total Int})
(error CartNotFound {:id CartId})
(error CardDeclined {:reason String})
(service Shop (: find-cart (-> CartId (Effect Cart [CartNotFound]))))
(service Payments (: charge (-> Int (Effect Payment [CardDeclined]))))
(service Mailer (: send (-> Email String (Effect Unit))))
(: receipt-message (-> Payment Int String))
(define
  receipt-message
  [paid total]
  (str "Receipt " (get paid :receipt-id) " for " total))
(:
  checkout
  (->
    CartId
    Email
    (Effect CheckoutReceipt [CartNotFound CardDeclined] [Shop Payments Mailer])))
(define
  checkout
  [cart-id email]
  (do
    (bind cart (Shop.find-cart cart-id))
    (let total (sum (map (fn [item] (get item :price)) (get cart :items))))
    (bind paid (Payments.charge total))
    (bind _ (Mailer.send email (receipt-message paid total)))
    (pure {:receipt (get paid :receipt-id) :total total})))
