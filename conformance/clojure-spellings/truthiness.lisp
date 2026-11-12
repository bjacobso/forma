; Clojure truthiness. `if` takes a Bool; an Option is not a condition.
(import "./clojure.lisp" [defn])
(export label)

(: label (-> (Option Int) String))
(defn label [coupon]
  (if coupon "discounted" "full price"))
