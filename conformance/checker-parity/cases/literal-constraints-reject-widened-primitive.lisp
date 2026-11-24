;; Shared contract: an unrefined primitive String cannot be assigned to a literal union.
(type Role (Union "admin" "member"))

(: bad-widen (-> String Role))
(define bad-widen [raw] raw)
