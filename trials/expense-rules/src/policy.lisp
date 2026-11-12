; Cents and epoch day numbers. Approvals identify both a person and their role.
(type Category (Union "travel" "meals" "software" "equipment"))
(type ApprovalRole (Union "manager" "finance"))
(type Expense
  {:employee String :amount Int :category Category :date Int
   :vendor (Option String) :asset-tag (Option String)})

(: required-approvals (-> Expense (List ApprovalRole)))
(define required-approvals [expense]
  (if (> expense.amount 250000)
    ["manager" "finance"]
    (if (= expense.category "meals")
      (if (> expense.amount 7500) ["manager"] [])
      [])))

; Can this person supply this required approval? This does not mean all
; required approvals have already been collected.
(: approvable? (-> Expense String ApprovalRole Bool))
(define approvable? [expense approver role]
  (if (= expense.employee approver) false
    (> (count (filter (fn [required] (= required role))
                       (required-approvals expense))) 0)))

(: nonempty? (-> (Option String) Bool))
(define nonempty? [value]
  (match value (Some text) (!= (trim text) "") None false))

(: valid-details? (-> Expense Bool))
(define valid-details? [expense]
  (if (= expense.category "software") (nonempty? expense.vendor)
    (if (= expense.category "equipment") (nonempty? expense.asset-tag) true)))

(export Category ApprovalRole Expense required-approvals approvable? nonempty? valid-details?)
