; Clojure multi-arity. `defn` in this library takes one parameter vector.
(import "./clojure.lisp" [defn])
(export total)

(defn total
  ([subtotal] (total subtotal 0))
  ([subtotal shipping] (+ subtotal shipping)))
