;; Pure domain logic: Schema classes, typed constants, helper functions,
;; value-level match over options, results, enums, and tagged unions, and
;; the collection and string functions that compile to plain TypeScript.

(define-schema Tier (Enum free pro enterprise))

(define-schema Discount
  (TaggedUnion type
    [percent (Struct (field rate Int))]
    [fixed (Struct (field cents Int))]
    [none (Struct)]))

(define-class Customer
  (:fields
    (field id String)
    (field name String)
    (field tier Tier)
    (field email (Optional String))))

(define-class LineItem
  (:fields
    (field sku String)
    (field quantity Int)
    (field unit-cents Int)))

(define-error EmptyCart (:fields (field customer String)))

(: tier-discounts (Map Discount))
(define tier-discounts
  {"free" {:type "none"}
   "pro" {:type "percent" :rate 10}
   "enterprise" {:type "fixed" :cents 500}})

(: subtotal (-> (Array LineItem) Int))
(define subtotal
  (fn [items]
    (reduce (fn [total item] (+ total (* (get item :quantity) (get item :unit-cents)))) 0 items)))

(: discount-for (-> Customer Discount))
(define discount-for
  (fn [customer]
    (get-or-else (get tier-discounts (get customer :tier)) {:type "none"})))

(: apply-discount (-> Discount Int Int))
(define apply-discount
  (fn [discount cents]
    (match discount
      (percent p) (- cents (quot (* cents (get p :rate)) 100))
      (fixed f) (max 0 (- cents (get f :cents)))
      none cents)))

(: tier-label (-> Tier String))
(define tier-label
  (fn [tier]
    (match tier
      "free" "Free"
      "pro" "Pro"
      _ "Enterprise")))

(: contact (-> Customer String))
(define contact
  (fn [customer]
    (match (get customer :email)
      (some address) (str (get customer :name) " <" address ">")
      none (get customer :name))))

(: shout (-> String String))
(define shout (fn [text] (str (upcase (trim text)) "!")))

(: skus (-> (Array LineItem) String))
(define skus
  (fn [items]
    (join (map (fn [item] (get item :sku)) (filter (fn [item] (> (get item :quantity) 0)) items)) ",")))

(: summarize (-> Customer (Array LineItem) (Effect String [EmptyCart] [])))
(define-operation summarize [customer items]
  (do! [nonempty (succeed (filter (fn [item] (> (get item :quantity) 0)) items))
        _ (when (empty? nonempty) (fail (EmptyCart {:customer (get customer :id)})))
        gross (succeed (subtotal nonempty))
        net (succeed (apply-discount (discount-for customer) gross))
        biggest (succeed (find (fn [item] (every? (fn [other] (>= (get item :unit-cents) (get other :unit-cents))) nonempty)) nonempty))]
    (succeed
      (str (contact customer) " [" (tier-label (get customer :tier)) "] "
           (count nonempty) " items (" (skus nonempty) "), "
           gross " -> " net " cents"
           (match biggest
             (some item) (str ", top " (get item :sku))
             none "")))))

(: outcome-label (-> Customer (Array LineItem) (Effect String [] [])))
(define-operation outcome-label [customer items]
  (do! [outcome (result (summarize customer items))]
    (succeed
      (match outcome
        (success text) text
        (failure error) (str "empty cart for " (get error :customer))))))

(: upgrade (-> Customer Customer))
(define upgrade
  (fn [customer]
    (assoc customer :tier
      (cond
        (= (get customer :tier) "free") "pro"
        :else "enterprise"))))

(: loud-names (-> (Array Customer) (Array String)))
(define loud-names
  (fn [customers]
    (let [names (map (fn [customer] (get customer :name)) customers)
          sorted (concat names ["staff"])]
      (map shout (conj sorted "everyone")))))
