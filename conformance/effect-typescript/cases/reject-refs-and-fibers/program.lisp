;; Refs, fibers, and collections keep their element types.
(: count-up (-> (List String) (Effect Int [] [])))
(define count-up [names]
  (do! [counter (ref-make 0)
        _ (ref-set counter "one")
        _ (ref-update counter (fn [n] (str n "!")))
        total (ref-get counter)]
    (succeed total)))

(: wait-for (-> Int (Effect Int [] [])))
(define wait-for [n]
  (do! [result (join n)]
    (succeed result)))

(: each-letter (-> String (Effect (List String) [] [])))
(define each-letter [word]
  (for-each word (fn [letter] (succeed letter))))
