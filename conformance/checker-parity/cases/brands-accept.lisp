;; Shared contract: nominal brands accept their own constructor, assign to their
;; base type (and supertypes like Int -> Float), and compose covariantly in Option.
(type UserId (Brand String))
(type Count (Brand Int))

(: user-id UserId)
(define user-id (UserId "user:1"))

(: count Count)
(define count (Count 3))

(: as-string (-> UserId String))
(define as-string [id] id)

(: as-float (-> Count Float))
(define as-float [n] n)

(: maybe-string (-> (Option UserId) (Option String)))
(define maybe-string [id] id)

(: label-user String)
(define label-user (as-string user-id))
