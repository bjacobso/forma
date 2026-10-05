;; Refs, fibers, and collections keep their element types.
(: count-up (-> (Array String) (Effect Int [] [])))
(define-operation count-up [names]
  (do! [counter (ref-make 0)
        _ (ref-set counter "one")
        _ (ref-update counter (fn [n] (str n "!")))
        total (ref-get counter)]
    (succeed total)))

(: wait-for (-> Int (Effect Int [] [])))
(define-operation wait-for [n]
  (do! [result (join n)]
    (succeed result)))

(: each-letter (-> String (Effect (Array String) [] [])))
(define-operation each-letter [word]
  (for-each word (fn [letter] (succeed letter))))
