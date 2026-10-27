;; A pure hot loop for the effect-go benchmarks: Forma compiles pure
;; functions to plain Go, with Int arithmetic checked against the safe range.
(: sum-of-squares (-> (List Int) Int))
(define sum-of-squares [xs] (reduce (fn [acc x] (+ acc (* x x))) 0 xs))
(: checksum (-> (List Int) (Effect Int)))
(define checksum [xs] (succeed (sum-of-squares xs)))
