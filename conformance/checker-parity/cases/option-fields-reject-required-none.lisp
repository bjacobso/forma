;; Shared contract: required non-Option fields reject None.
(type Stage {:note (Option String) :n Int})

(: bad-required Stage)
(define bad-required {:n None})
