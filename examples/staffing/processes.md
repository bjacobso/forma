# Process

```lisp
(export employee-onboarding)

;; =============================================================================
;; Staffing Agency Ontology - Canonical Process
;; =============================================================================
;;
;; Canonical process form for the employee onboarding DAG.
;;
(process employee-onboarding
  :description
    "Full onboarding compliance process: parallel document collection, employer review, background check, and activation"
  :trigger (on-create Employee)
  (node
    generate-tasks
    :action
    generate-onboarding-tasks
    :input
    {:entity-id (-> context (get :entityId))})
  (node employee-documents-start)
  (node
    i9-section-1
    :action
    collect-form
    :input
    {:section-ids "employee-information" :assignee-type "entity"})
  (node
    w4-form
    :action
    collect-form
    :input
    {:section-ids "employee-tax-info" :assignee-type "entity"})
  (node
    direct-deposit
    :action
    collect-form
    :input
    {:section-ids "bank-information" :assignee-type "entity"})
  (node
    handbook-ack
    :action
    collect-form
    :input
    {:section-ids "handbook-acknowledgment" :assignee-type "entity"})
  (node employee-documents-end :join "all")
  (node employer-review-start)
  (node
    i9-section-2
    :action
    collect-form
    :input
    {
      :section-ids "employer-review"
      :assignee-type "role"
      :assignee-role "hr-verifier"})
  (node
    initiate-bgc
    :action
    create-bgc-task
    :input
    {:entity-id (-> context (get :entityId))})
  (node
    generate-i9-pdf
    :action
    generate-i9-pdf
    :input
    {:entity-id (-> context (get :entityId))})
  (node employer-review-end :join "all")
  (node all-complete :action evaluate-condition :fan-out "first")
  (node
    activate-employee
    :action
    mark-compliant
    :input
    {:entity-id (-> context (get :entityId))})
  (node
    send-reminder
    :action
    send-notification
    :input
    {
      :to (-> context (get :employeeEmail))
      :subject "Onboarding reminder: please complete your remaining tasks"})
  (edge generate-tasks employee-documents-start)
  (edge employee-documents-start i9-section-1)
  (edge employee-documents-start w4-form)
  (edge employee-documents-start direct-deposit)
  (edge employee-documents-start handbook-ack)
  (edge i9-section-1 employee-documents-end)
  (edge w4-form employee-documents-end)
  (edge direct-deposit employee-documents-end)
  (edge handbook-ack employee-documents-end)
  (edge employee-documents-end employer-review-start)
  (edge employer-review-start i9-section-2)
  (edge employer-review-start initiate-bgc)
  (edge i9-section-2 generate-i9-pdf)
  (edge generate-i9-pdf employer-review-end)
  (edge initiate-bgc employer-review-end)
  (edge employer-review-end all-complete)
  (edge
    all-complete
    activate-employee
    :guard
    (-> outputs (get :all-complete) (get :action)))
  (edge
    all-complete
    send-reminder
    :guard
    (not (-> outputs (get :all-complete) (get :action)))))
```
