; Clojure nil punning. `nil` is a Unit value, not an absent Int.
(import "./clojure.lisp" [defn])
(export lookup)

(: lookup (-> Int (Option Int)))
(defn lookup [id]
  (if (> id 0) (Some id) nil))
