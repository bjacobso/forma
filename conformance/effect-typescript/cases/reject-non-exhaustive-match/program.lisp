;; Every case of an Option, enum, or tagged union must be handled.
(define-schema Status (Enum active suspended closed))

(define-service Accounts
  (:methods
    (status [id String] (Effect (Option Status) [] []))))

(: describe-account (-> String (Effect String [] [Accounts.status])))
(define-operation describe-account [id]
  (do! [status (Accounts.status id)]
    (match status
      (some current)
        (match current
          "active" (succeed "open")
          "suspended" (succeed "on hold"))
      none (succeed "unknown"))))
