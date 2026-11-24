;; Shared contract: a literal outside the union is rejected.
(type Role (Union "admin" "member"))

(: bad-role Role)
(define bad-role "guest")
