/**
 * Forma programs shown on the docs `/effect` page. The page imports these
 * sources and their real compiler output from `docs/snippets/effect`; see
 * `effectPageSnippets` in `docsSnippets.ts`.
 */

/** The page's main example: an order payment operation. */
export const ordersSource = `(type OrderId (Brand String))

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

(: pay (-> OrderId (Effect Order [OrderNotFound PaymentDeclined] [Orders Payments.charge])))
(define pay [id]
  (do! [found (Orders.find id)]
    (match found
      None (fail (OrderNotFound {:id id}))
      (Some order)
        (do! [_ (retry (Payments.charge (get order :total-cents)) :times 2)
              paid (succeed (assoc order :status "paid"))
              _ (Orders.save paid)]
          (succeed paid)))))`;

/** The same operation with PaymentDeclined left out of the signature. */
export const ordersUndeclaredSource = ordersSource.replace(
  "(Effect Order [OrderNotFound PaymentDeclined] [Orders Payments.charge])",
  "(Effect Order [OrderNotFound] [Orders Payments.charge])",
);

/** Mistakes TypeScript accepts once the code is generated. */
export const strictSource = `(type Money {:amount Int
 :currency String})

(: same-price? (-> Money Money Bool))
(define same-price?  [a b] (= a b))

(: label (-> Money String))
(define label  [price] (str "price: " price))

(: half (-> Int Int))
(define half  [n] (/ n 2))

(: describe (-> Int String))
(define describe  [count] (if count "some" "none"))`;
