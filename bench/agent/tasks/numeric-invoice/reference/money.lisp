(export Line Totals subtotal line-tax invoice)
(type Line {:cents Int :quantity Int :tax-bps Int})
(type Totals {:net Int :tax Int :gross Int})
(: subtotal (-> Line Int))
(define subtotal [l] (* l.cents l.quantity))
(: line-tax (-> Line Int))
(define line-tax [l]
 (let [n (* (subtotal l) l.tax-bps)]
  (if (< n 0) (- 0 (quot (+ (- 0 n) 5000) 10000)) (quot (+ n 5000) 10000))))
(: add-net (-> Int Line Int))
(define add-net [a l] (+ a (subtotal l)))
(: add-tax (-> Int Line Int))
(define add-tax [a l] (+ a (line-tax l)))
(: invoice (-> (List Line) Totals))
(define invoice [lines]
 (let [net (reduce add-net 0 lines)
       tax (reduce add-tax 0 lines)]
  {:net net :tax tax :gross (+ net tax)}))
