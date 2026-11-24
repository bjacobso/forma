;; Shared contract: Option fields accept Some, None, plain values, propagation,
;; and covariant Option<Int> -> Option<Float>.
(type Stage {:note (Option String) :n Int})

(: with-some Stage)
(define with-some {:note (Some "present") :n 1})

(: with-none Stage)
(define with-none {:note None :n 2})

(: with-plain Stage)
(define with-plain {:note "plain" :n 3})

(: copy-stage (-> Stage Stage))
(define copy-stage [stage]
  {:note (get stage :note) :n 4})

(: widen-option (-> (Option Int) (Option Float)))
(define widen-option [x] x)
