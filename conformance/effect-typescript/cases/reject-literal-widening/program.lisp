;; Without a target type a record literal's fields widen, as in TypeScript:
;; :role is a String here, not a Role. Writing (Member {...}) types it.
(type Role (Union :admin :member))
(type Member {:name String
 :role Role})

(service Members
  (: save (-> Member (Effect Unit [] []))))

(: invite (-> String (Effect Unit [] [Members.save])))
(define invite [name]
  (do! [member (succeed {:name name :role "member"})]
    (Members.save member)))
