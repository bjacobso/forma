;; Shared contract: direct annotation rejects a literal below :min.
(type Cents (Int :min 0))

(: refund Cents)
(define refund -5)
