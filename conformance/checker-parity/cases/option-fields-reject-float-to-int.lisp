;; Shared contract: covariant Option rejects Float -> Int narrowing.
(: narrow-option (-> (Option Float) (Option Int)))
(define narrow-option [x] x)
