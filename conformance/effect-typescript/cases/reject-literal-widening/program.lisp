;; Without a target type a record literal's fields widen, as in TypeScript:
;; :role is a String here, not a Role. Writing (Member {...}) types it.
(define-schema Role (Enum admin member))
(define-schema Member (Struct (field name String) (field role Role)))

(define-service Members
  (:methods
    (save [member Member] (Effect Unit [] []))))

(: invite (-> String (Effect Unit [] [Members.save])))
(define-operation invite [name]
  (do! [member (succeed {:name name :role "member"})]
    (Members.save member)))
