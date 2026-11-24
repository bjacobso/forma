;; Shared contract: distinct nominal brands over the same base type are incompatible.
(type UserId (Brand String))
(type OrderId (Brand String))

(: read-user (-> UserId String))
(define read-user [id] id)

(: bad-brand String)
(define bad-brand (read-user (OrderId "order:1")))
