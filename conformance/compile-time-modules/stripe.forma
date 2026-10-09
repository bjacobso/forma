(export price PriceDecl PriceIR)

(type PriceDecl Symbol)
(type PriceIR {:kind "Price" :name Symbol :label String :amount Int})

(define display-label [label] (str "Stripe: " label))

(form (price name label amount)
  "Declare an inspectable Stripe price."
  :types {:name (Declares PriceDecl) :label String :amount Int}
  :ir PriceIR
  :check (fn [holes]
    (if (< (get holes :amount) 0)
      [{:severity "error" :slot "amount" :message "Price amount must be nonnegative"}]
      []))
  {:kind "Price" :name name :label (display-label label) :amount amount})
