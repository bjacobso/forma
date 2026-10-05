;; The body can fail with UserNotFound, but the signature promises no errors.
(define-error UserNotFound (:fields (field id String)))

(: lookup (-> String (Effect String [] [])))
(define-operation lookup [id]
  (if (= id "root")
    (succeed "root")
    (fail (UserNotFound {:id id}))))
