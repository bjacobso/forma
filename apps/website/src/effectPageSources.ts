/**
 * Forma programs shown on the docs `/effect` page. The page imports these
 * sources and their real compiler output from `docs/snippets/effect`; see
 * `effectPageSnippets` in `docsSnippets.ts`.
 */

/** The page's main example: an order payment operation. */
export const ordersSource = `(define-schema OrderId (Brand OrderId String))

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

(: pay (-> OrderId (Effect Order [OrderNotFound PaymentDeclined] [Orders Payments.charge])))
(define-operation pay [id]
  (do! [found (Orders.find id)]
    (match found
      none (fail (OrderNotFound {:id id}))
      (some order)
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
export const strictSource = `(define-schema Money
  (Struct
    (field amount Int)
    (field currency String)))

(: same-price? (-> Money Money Bool))
(define same-price? (fn [a b] (= a b)))

(: label (-> Money String))
(define label (fn [price] (str "price: " price)))

(: half (-> Int Int))
(define half (fn [n] (/ n 2)))

(: describe (-> Int String))
(define describe (fn [count] (if count "some" "none")))`;
