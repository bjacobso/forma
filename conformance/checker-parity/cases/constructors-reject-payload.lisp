;; Shared contract: constructor payload fields are checked against the variant schema.
(type Ev (Tagged (Placed {:id String}) (Billed {:amount Int})))

(: bad-payload Ev)
(define bad-payload (Ev.Placed {:id 7}))
