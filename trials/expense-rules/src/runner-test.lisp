; Runner companion to policy-test.lisp; historical suite is preserved.
(import "../../../preludes/modules/test.lisp" [test is=])
(import "./policy.lisp" [Category ApprovalRole Expense required-approvals approvable? valid-details?])
(: sample (-> Int Category Expense))
(define sample [amount category]
  {:employee "alice" :amount amount :category category :date 20768
   :vendor None :asset-tag None})
(: manager-only (List ApprovalRole))
(define manager-only ["manager"])
(: both-roles (List ApprovalRole))
(define both-roles ["manager" "finance"])

(test "meal at threshold"
  (is= (required-approvals (sample 7500 "meals")) []))

(test "meal over threshold"
  (is= (required-approvals (sample 7501 "meals")) manager-only))

(test "travel no meal threshold"
  (is= (required-approvals (sample 7501 "travel")) []))

(test "finance boundary"
  (is= (required-approvals (sample 250000 "equipment")) []))

(test "meal finance boundary"
  (is= (required-approvals (sample 250000 "meals")) manager-only))

(test "large travel needs both"
  (is= (required-approvals (sample 250001 "travel")) both-roles))

(test "large meal needs both"
  (is= (required-approvals (sample 250001 "meals")) both-roles))

(test "large software needs both"
  (is= (required-approvals (sample 250001 "software")) both-roles))

(test "large equipment needs both"
  (is= (required-approvals (sample 250001 "equipment")) both-roles))

(test "self manager denied"
  (is= (approvable? (sample 250001 "travel") "alice" "manager") false))

(test "self finance denied"
  (is= (approvable? (sample 250001 "travel") "alice" "finance") false))

(test "other manager allowed"
  (is= (approvable? (sample 7501 "meals") "bob" "manager") true))

(test "unneeded finance denied"
  (is= (approvable? (sample 7501 "meals") "bob" "finance") false))

(test "other finance allowed"
  (is= (approvable? (sample 250001 "travel") "bob" "finance") true))

(test "software missing vendor"
  (is= (valid-details? (sample 100 "software")) false))

(test "equipment missing tag"
  (is= (valid-details? (sample 100 "equipment")) false))

(test "travel no metadata"
  (is= (valid-details? (sample 100 "travel")) true))

(test "software named vendor"
  (is= (valid-details? {:employee "alice" :amount 100 :category "software" :date 1 :vendor (Some "Acme") :asset-tag None}) true))

(test "blank vendor denied"
  (is= (valid-details? {:employee "alice" :amount 100 :category "software" :date 1 :vendor (Some "  ") :asset-tag None}) false))

(test "equipment tagged"
  (is= (valid-details? {:employee "alice" :amount 100 :category "equipment" :date 1 :vendor None :asset-tag (Some "A-1")}) true))
