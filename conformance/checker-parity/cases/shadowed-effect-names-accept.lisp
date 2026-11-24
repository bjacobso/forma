;; Shared contract: local parameter and let bindings shadowing outer or Effect names
;; resolve to the inner binding's type.
(: outer Int)
(define outer 10)

(: shadow-effect-param (-> String String))
(define shadow-effect-param [succeed]
  (let [fail succeed]
    fail))

(: shadow-outer-let (-> String String))
(define shadow-outer-let [x]
  (let [outer x]
    outer))
