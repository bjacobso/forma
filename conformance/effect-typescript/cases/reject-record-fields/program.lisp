;; Records must have exactly the schema's fields.
(define-schema Point (Struct (field x Int) (field y Int)))

(: origin (-> (Effect Point [] [])))
(define-operation origin []
  (succeed {:x 0}))

(: shifted (-> Point (Effect Point [] [])))
(define-operation shifted [point]
  (succeed {:x (+ (get point :x) 1) :y (get point :y) :z 0}))
