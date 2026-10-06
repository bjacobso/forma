;; Every case of an Option, enum, or tagged union must be handled.
(type Status (Union :active :suspended :closed))

(service Accounts
  (: status (-> String (Effect (Option Status) [] []))))

(: describe-account (-> String (Effect String [] [Accounts.status])))
(define describe-account [id]
  (do! [status (Accounts.status id)]
    (match status
      (Some current)
        (match current
          "active" (succeed "open")
          "suspended" (succeed "on hold"))
      None (succeed "unknown"))))
