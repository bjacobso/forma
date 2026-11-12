; Clojure keyword access. `(:key m)` is an application of a keyword; Forma
; core rejects a non-symbol head, and `get` is the supported spelling.
(import "./clojure.lisp" [defn])
(export customer-name)

(defn customer-name [order]
  (:customer order))
