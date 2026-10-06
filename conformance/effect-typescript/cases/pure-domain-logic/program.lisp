;; Pure domain logic: Schema classes, typed constants, helper functions,
;; value-level match over options, results, enums, and tagged unions, and
;; the collection and string functions that compile to plain TypeScript.
(type Tier (Union :free :pro :enterprise))
(type
  Discount
  (Tagged :tag type (Percent {:rate Int}) (Fixed {:cents Int}) (None {})))
(class Customer {:id String :name String :tier Tier :email (Option String)})
(class LineItem {:sku String :quantity Int :unit-cents Int})
(error EmptyCart {:customer String})
(: tier-discounts (Map String Discount))
(define
  tier-discounts
  {
    "free" {:type "None"}
    "pro" {:type "Percent" :rate 10}
    "enterprise" {:type "Fixed" :cents 500}})
(: subtotal (-> (List LineItem) Int))
(define
  subtotal
  [items]
  (reduce
    (fn [total item] (+ total (* (get item :quantity) (get item :unit-cents))))
    0
    items))
(: discount-for (-> Customer Discount))
(define
  discount-for
  [customer]
  (get-or-else (get tier-discounts (get customer :tier)) {:type "None"}))
(: apply-discount (-> Discount Int Int))
(define
  apply-discount
  [discount cents]
  (match
    discount
    (Percent p)
    (- cents (quot (* cents (get p :rate)) 100))
    (Fixed f)
    (max 0 (- cents (get f :cents)))
    None
    cents))
(: tier-label (-> Tier String))
(define tier-label [tier] (match tier "free" "Free" "pro" "Pro" _ "Enterprise"))
(: contact (-> Customer String))
(define
  contact
  [customer]
  (match
    (get customer :email)
    (Some address)
    (str (get customer :name) " <" address ">")
    None
    (get customer :name)))
(: shout (-> String String))
(define shout [text] (str (upcase (trim text)) "!"))
(: skus (-> (List LineItem) String))
(define
  skus
  [items]
  (join
    (map
      (fn [item] (get item :sku))
      (filter (fn [item] (> (get item :quantity) 0)) items))
    ","))
(: summarize (-> Customer (List LineItem) (Effect String [EmptyCart] [])))
(define
  summarize
  [customer items]
  (do!
    [
      :let
      [nonempty (filter (fn [item] (> (get item :quantity) 0)) items)]
      _
      (when (empty? nonempty) (fail (EmptyCart {:customer (get customer :id)})))
      :let
      [gross (subtotal nonempty)]
      :let
      [net (apply-discount (discount-for customer) gross)]
      :let
      [
        biggest
        (find
          (fn
            [item]
            (every?
              (fn [other] (>= (get item :unit-cents) (get other :unit-cents)))
              nonempty))
          nonempty)]]
    (succeed
      (str
        (contact customer)
        " ["
        (tier-label (get customer :tier))
        "] "
        (count nonempty)
        " items ("
        (skus nonempty)
        "), "
        gross
        " -> "
        net
        " cents"
        (match biggest (Some item) (str ", top " (get item :sku)) None "")))))
(: outcome-label (-> Customer (List LineItem) (Effect String)))
(define
  outcome-label
  [customer items]
  (do!
    [outcome (result (summarize customer items))]
    (succeed
      (match
        outcome
        (Ok text)
        text
        (Err error)
        (str "empty cart for " (get error :customer))))))
(: upgrade (-> Customer Customer))
(define
  upgrade
  [customer]
  (assoc
    customer
    :tier
    (cond (= (get customer :tier) "free") "pro" :else "enterprise")))
(: loud-names (-> (List Customer) (List String)))
(define
  loud-names
  [customers]
  (let
    [
      names
      (map (fn [customer] (get customer :name)) customers)
      sorted
      (concat names ["staff"])]
    (map shout (conj sorted "everyone"))))
