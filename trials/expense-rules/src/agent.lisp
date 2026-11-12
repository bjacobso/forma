; Agent-authored program: ask policy before requesting a host notification.
(: request Expense)
(define request {:employee "alice" :amount 300000 :category "travel" :date 20768 :vendor None :asset-tag None})
(if (approvable? request "bob" "manager")
  (notify (str "Expense needs " (count (required-approvals request)) " approvals."))
  "Approval denied")
