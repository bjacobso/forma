(: quote-for (-> Int (Option Int) String))
(defn quote-for [subtotal coupon]
  (-> (after-coupon subtotal coupon)
      (+ (shipping-for subtotal))
      (str " cents")))
