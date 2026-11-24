;; Shared contract: a raw base value cannot be assigned where a nominal Brand is expected.
(type UserId (Brand String))

(: read-user (-> UserId String))
(define read-user [id] id)

(: bad-call String)
(define bad-call (read-user "user:1"))
