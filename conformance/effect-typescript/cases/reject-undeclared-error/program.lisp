;; The body can fail with UserNotFound, but the signature promises no errors.
(error UserNotFound {:id String})

(: lookup (-> String (Effect String [] [])))
(define lookup [id]
  (if (= id "root")
    (succeed "root")
    (fail (UserNotFound {:id id}))))
