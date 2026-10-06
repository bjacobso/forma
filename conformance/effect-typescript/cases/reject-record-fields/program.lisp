;; Records must have exactly the schema's fields.
(type Point {:x Int
 :y Int})

(: origin (Effect Point [] []))
(define origin (succeed {:x 0}))

(: shifted (-> Point (Effect Point [] [])))
(define shifted [point]
  (succeed {:x (+ (get point :x) 1) :y (get point :y) :z 0}))
