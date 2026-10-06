# Actions

```lisp
(export
  create-covered-placement
  sync-employee-cba-attribute
  start-union-authorization-card
  collect-form
  submit-union-authorization-card
  emit-card-completed-webhook
  mark-document-routed
  flag-rehire-review)

;; =============================================================================
;; Labor Relations Ontology - Actions
;; =============================================================================
(:
  create-covered-placement
  (->
    Employer
    {
      :firstName String
      :lastName String
      :email (Option String)
      :phone (Option String)
      :globalHrId (Option String)
      :hireEventId (Option String)
      :address (Option String)
      :startDate Number
      :cbaId (Option String)
      :positionId (Option (Id Position))}
    (Action Bool)))
(define
  create-covered-placement
  [employer input]
  (do!
    []
    (do!
      [
        employee-id
        (create!
          Employee
          {
            :first-name (get input :firstName)
            :last-name (get input :lastName)
            :email (get input :email)
            :phone (get input :phone)
            :status "preboarding"
            :global-hr-id (get input :globalHrId)
            :hire-event-id (get input :hireEventId)
            :rehire-indicator false
            :address (get input :address)
            :union-card-signed false})
        placement-id
        (create!
          Placement
          {
            :start-date (get input :startDate)
            :status "covered-pending-card"
            :source-system "Enterprise HRIS"
            :cba-id (get input :cbaId)
            :employee employee-id
            :position (get input :positionId)
            :employer employer.id})
        link-id
        (link! placed-in employee-id placement-id {})]
      true)))
(: sync-employee-cba-attribute (-> Employee {:cbaId String} (Action Bool)))
(define
  sync-employee-cba-attribute
  [employee input]
  (do! [_ (update! Employee employee.id {:cba-id (get input :cbaId)})] true))
(:
  start-union-authorization-card
  (->
    Employee
    {
      :dueDate (Option Number)
      :templateVersion (Option String)
      :placementId (Option (Id Placement))
      :cbaId (Option (Id CollectiveBargainingAgreement))}
    (Action Bool)))
(define
  start-union-authorization-card
  [employee input]
  (do!
    []
    (do!
      [
        instance-id
        (instantiate! union-authorization-card Employee employee.id)
        task-id
        (task!
          Employee
          {
            :title "Complete Union Authorization Card"
            :type "data-entry"
            :priority "critical"
            :entity-id employee.id
            :entity-type "Employee"
            :document-ref "union-authorization-card"
            :document-instance-ref instance-id
            :section-refs ["employee-authorization"]
            :assignee-role "employee"})
        auth-task-id
        (create!
          UnionAuthorizationTask
          {
            :unionauthtask/title "Complete Union Authorization Card"
            :unionauthtask/status "pending"
            :unionauthtask/priority "critical"
            :unionauthtask/assignee-role "employee"
            :unionauthtask/delivery-channel "Candidate Messaging"
            :unionauthtask/due-date (get input :dueDate)
            :unionauthtask/template-version (get input :templateVersion)
            :unionauthtask/runtime-task-id task-id
            :unionauthtask/document-instance-id instance-id
            :unionauthtask/employee employee.id
            :unionauthtask/placement (get input :placementId)
            :unionauthtask/cba (get input :cbaId)})]
      true)))
(: collect-form (-> Employee (Action Bool)))
(define collect-form [employee] (do! [_ (emit! "collect-form")] true))
(: submit-union-authorization-card (-> Employee Number (Action Bool)))
(define
  submit-union-authorization-card
  [employee timestamp]
  (do!
    [_ (update! Employee employee.id {:union-card-signed true})]
    (do!
      [
        document-id
        (create!
          ExecutedAuthorizationDocument
          {
            :executeddocument/name "Completed Union Authorization Card"
            :executeddocument/status "available"
            :executeddocument/signed-at timestamp
            :executeddocument/template-version "submitted"
            :executeddocument/pdf-reference
              "api://documents/submitted-union-card/pdf"
            :executeddocument/structured-data-reference
              "api://documents/submitted-union-card/data"
            :executeddocument/routing-status "ready"
            :executeddocument/employee employee.id})]
      true)))
(:
  emit-card-completed-webhook
  (-> ExecutedAuthorizationDocument Number (Action Bool)))
(define
  emit-card-completed-webhook
  [document timestamp]
  (do!
    []
    (do!
      [
        event-id
        (create!
          IntegrationEvent
          {
            :integrationevent/event-type "task_updated"
            :integrationevent/status "pending"
            :integrationevent/target-system "Associate Digital File"
            :integrationevent/emitted-at timestamp
            :integrationevent/payload-summary
              "Authorization card completed; PDF and structured data are available for retrieval."
            :integrationevent/document document.id})]
      true)))
(: mark-document-routed (-> ExecutedAuthorizationDocument (Action Bool)))
(define
  mark-document-routed
  [document]
  (do!
    [
      _
      (update!
        ExecutedAuthorizationDocument
        document.id
        {:executeddocument/routing-status "routed"})]
    true))
(: flag-rehire-review (-> Employee (Action Bool)))
(define
  flag-rehire-review
  [employee]
  (do!
    [_ (emit! "flag-rehire-review")]
    (match
      (get employee :rehire-indicator)
      (Some __value0)
      (= __value0 true)
      None
      false)))
```
