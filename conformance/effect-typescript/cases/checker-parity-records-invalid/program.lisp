;; Constructor identity must not hide invalid payloads, and Option filling
;; applies only to optional fields with a compatible item type.
(type Ev (Tagged (Placed {:id String}) (Billed {:amount Int})))
(type Other (Tagged (Nope {})))
(type Stage {:note (Option String) :n Int})
(: bad-payload Ev)
(define bad-payload (Ev.Placed {:id 7}))
(: wrong-owner (List Ev))
(define wrong-owner [(Other.Nope)])
(: bad-option Stage)
(define bad-option {:note (Some 12) :n 1})
(: bad-required Stage)
(define bad-required {:n None})
