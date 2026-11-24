;; Shared contract: a constructor from an unrelated union is rejected.
(type Ev (Tagged (Placed {:id String}) (Billed {:amount Int})))
(type Other (Tagged (Nope {})))

(: wrong-owner (List Ev))
(define wrong-owner [(Other.Nope)])
