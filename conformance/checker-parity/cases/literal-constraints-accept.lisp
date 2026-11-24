;; Shared contract: literal unions accept matching members, conditional joins of
;; valid members, and widen to their base primitive.
(type Role (Union "admin" "member"))

(: admin-role Role)
(define admin-role "admin")

(: choose-role (-> Bool Role))
(define choose-role [is-admin]
  (if is-admin "admin" "member"))

(: role-as-string (-> Role String))
(define role-as-string [role] role)
