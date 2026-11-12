(import "./forms.lisp" [approval])
(approval small :amount 7500 :role "manager" :approved-on 100 :as-of 281 :reason "meal" :status "active")
(approval large :amount 250001 :role "finance" :approved-on 100 :as-of 100 :reason "asset" :status "active")
(approval pending :amount 250001 :role "manager" :approved-on 100 :as-of 282 :reason "asset" :status "draft")
