# Actions

```lisp
(export
  hire-employee
  hire-existing-employee
  generate-onboarding-tasks
  start-i9
  create-bgc-task
  complete-onboarding
  collect-form
  evaluate-condition
  send-notification
  generate-i9-pdf
  start-i9-section-2
  complete-w4-task
  complete-bgc-task
  complete-direct-deposit-task
  complete-handbook-task
  complete-state-tax-task
  complete-idv-task
  mark-compliant)

;; =============================================================================
;; Staffing Agency Ontology - Canonical Actions
;; =============================================================================
;;
;; Canonical actions use a single Lisp do body instead of a separate effects
;; language. These examples also exercise HM checking over actual (do ...)
;; blocks, not just single expressions.
;;
(:
  hire-employee
  (->
    Employer
    {:firstName String :lastName String :email (Option String)}
    Number
    (Action Bool)))
(define
  hire-employee
  [employer input timestamp]
  (do!
    []
    (do!
      [
        :let
        [hire-date timestamp]
        emp-id
        (create!
          Employee
          {
            :first-name (get input :firstName)
            :last-name (get input :lastName)
            :email (get input :email)
            :status "onboarding"
            :hire-date hire-date})
        plc-id
        (create!
          Placement
          {
            :employee emp-id
            :employer employer.id
            :status "active"
            :start-date hire-date})
        link-id
        (link!
          works-at
          emp-id
          employer.id
          {:start-date hire-date :status "active"})]
      true)))
(: hire-existing-employee (-> Employer Employee Number (Action Bool)))
(define
  hire-existing-employee
  [employer employee timestamp]
  (do!
    []
    (do!
      [
        :let
        [hire-date timestamp]
        :let
        [employee-id employee.id]
        plc-id
        (create!
          Placement
          {
            :employee employee-id
            :employer employer.id
            :status "active"
            :start-date hire-date})
        link-id
        (link!
          works-at
          employee-id
          employer.id
          {:start-date hire-date :status "active"})]
      (do!
        [
          _
          (update! Employee employee.id {:status "onboarding"})
          _
          (update! Employee employee.id {:hire-date hire-date})]
        true))))
(: generate-onboarding-tasks (-> Employee Employer (Action Bool)))
(define
  generate-onboarding-tasks
  [employee employer]
  (do!
    [
      _
      (emit! "generate-onboarding-tasks")
      _
      (update! Employee employee.id {:status "pending"})]
    (and
      (= (get employee :status) "onboarding")
      (= (get employer :status) "active"))))
(: start-i9 (-> Employee (Action Bool)))
(define
  start-i9
  [employee]
  (do!
    []
    (do!
      [
        instance-id
        (instantiate! i-9-employment-eligibility Employee employee.id)
        task-id
        (task!
          Employee
          {
            :title "I-9 Section 1 — Employee Information"
            :type "data-entry"
            :priority "critical"
            :entity-id employee.id
            :entity-type "Employee"
            :document-ref "i-9-employment-eligibility"
            :document-instance-ref instance-id
            :section-refs ["employee-information"]
            :assignee-role "employee"})]
      true)))
(: create-bgc-task (-> Employee (Action Bool)))
(define
  create-bgc-task
  [employee]
  (do! [_ (emit! "create-bgc-task")] (= (get employee :status) "onboarding")))
(: complete-onboarding (-> Employee (Action Bool)))
(define
  complete-onboarding
  [employee]
  (do! [_ (update! Employee employee.id {:status "active"})] true))
(: collect-form (-> Employee (Action Bool)))
(define collect-form [employee] (do! [_ (emit! "collect-form")] true))
(: evaluate-condition (-> Employee (Action Bool)))
(define
  evaluate-condition
  [employee]
  (do! [_ (emit! "evaluate-condition")] (= (get employee :status) "active")))
(: send-notification (-> Employee (Action Bool)))
(define send-notification [employee] (do! [_ (emit! "send-notification")] true))
(: generate-i9-pdf (-> Employee (Action Bool)))
(define generate-i9-pdf [employee] (do! [_ (emit! "generate-i9-pdf")] true))
(:
  start-i9-section-2
  (-> Employee {:__documentInstanceId String} (Action Bool)))
(define
  start-i9-section-2
  [employee input]
  (do!
    []
    (do!
      [
        task-id
        (task!
          Employee
          {
            :title "I-9 Section 2 — Employer Review"
            :type "data-entry"
            :priority "critical"
            :entity-id employee.id
            :entity-type "Employee"
            :document-ref "i-9-employment-eligibility"
            :document-instance-ref (get input :__documentInstanceId)
            :section-refs ["employer-review"]
            :assignee-role "employer"})]
      true)))
(: complete-w4-task (-> Employee (Action Bool)))
(define complete-w4-task [employee] (do! [_ (emit! "complete-w4-task")] true))
(: complete-bgc-task (-> Employee (Action Bool)))
(define complete-bgc-task [employee] (do! [_ (emit! "complete-bgc-task")] true))
(: complete-direct-deposit-task (-> Employee (Action Bool)))
(define
  complete-direct-deposit-task
  [employee]
  (do! [_ (emit! "complete-direct-deposit-task")] true))
(: complete-handbook-task (-> Employee (Action Bool)))
(define
  complete-handbook-task
  [employee]
  (do! [_ (emit! "complete-handbook-task")] true))
(: complete-state-tax-task (-> Employee (Action Bool)))
(define
  complete-state-tax-task
  [employee]
  (do! [_ (emit! "complete-state-tax-task")] true))
(: complete-idv-task (-> Employee (Action Bool)))
(define complete-idv-task [employee] (do! [_ (emit! "complete-idv-task")] true))
(: mark-compliant (-> Employee (Action Bool)))
(define
  mark-compliant
  [employee]
  (do! [_ (update! Employee employee.id {:status "active"})] true))
```
