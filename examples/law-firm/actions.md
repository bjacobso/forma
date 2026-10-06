# Actions

```lisp
(export
  create-client
  create-intake-packet
  submit-intake-packet
  complete-firm-review
  run-conflict-check
  approve-conflict-check
  escalate-conflict-check
  generate-engagement-letter
  complete-engagement-letter
  open-matter
  activate-matter
  add-case-task
  complete-case-task
  request-documents
  mark-documents-received
  approve-invoice
  flag-client-risk
  send-notification
  escalate-to-attorney)

;; =============================================================================
;; Law Firm Backoffice Ontology - Actions
;; =============================================================================
;; ---------------------------------------------------------------------------
;; Client Intake
;; ---------------------------------------------------------------------------
(:
  create-client
  (->
    Attorney
    {
      :name String
      :type String
      :industry (Option String)
      :email (Option String)
      :source (Option String)}
    Number
    (Action Bool)))
(define
  create-client
  [attorney input timestamp]
  (do!
    []
    (do!
      [
        client-id
        (create!
          Client
          {
            :name (get input :name)
            :type (get input :type)
            :industry (get input :industry)
            :email (get input :email)
            :status "onboarding"
            :risk-level "medium"
            :source (get input :source)})
        intake-id
        (create!
          IntakePacket
          {
            :intakepacket/status "draft"
            :intakepacket/notes "Created during client intake"})
        conflict-id
        (create!
          ConflictCheck
          {
            :conflictcheck/status "pending"
            :conflictcheck/search-terms (get input :name)
            :conflictcheck/notes "Initial conflicts search queued"})
        link1
        (link! intake-for intake-id client-id {})
        link2
        (link! conflict-for conflict-id client-id {})
        link3
        (link!
          represents
          attorney.id
          client-id
          {:since timestamp :role "prospective-lead"})]
      true)))
(: create-intake-packet (-> Client (Action Bool)))
(define
  create-intake-packet
  [client]
  (do!
    []
    (do!
      [
        instance-id
        (instantiate! client-intake-form Client client.id)
        intake-id
        (create!
          IntakePacket
          {
            :intakepacket/status "draft"
            :intakepacket/notes "Client intake packet opened"})
        conflict-id
        (create!
          ConflictCheck
          {
            :conflictcheck/status "pending"
            :conflictcheck/search-terms (get client :name)
            :conflictcheck/result "not-run"
            :conflictcheck/notes "Initial conflicts search queued"})
        task-id
        (task!
          Client
          {
            :title "Complete Client Intake Packet"
            :type "data-entry"
            :priority "high"
            :entity-id client.id
            :entity-type "Client"
            :document-ref "client-intake-form"
            :document-instance-ref instance-id
            :section-refs ["client-background"]
            :assignee-role "client-contact"})
        link1
        (link! intake-for intake-id client.id {})
        link2
        (link! conflict-for conflict-id client.id {})]
      true)))
(: submit-intake-packet (-> Client Number (Action Bool)))
(define
  submit-intake-packet
  [client timestamp]
  (do!
    []
    (do!
      [
        packet-id
        (create!
          IntakePacket
          {
            :intakepacket/status "submitted"
            :intakepacket/submitted-at timestamp
            :intakepacket/notes
              "Client-submitted background, matter summary, and related parties"})
        link-id
        (link! intake-for packet-id client.id {})]
      true)))
(: complete-firm-review (-> Client Number (Action Bool)))
(define
  complete-firm-review
  [client timestamp]
  (do!
    []
    (do!
      [
        check-id
        (create!
          ConflictCheck
          {
            :conflictcheck/status "cleared"
            :conflictcheck/search-terms (get client :name)
            :conflictcheck/result "clear"
            :conflictcheck/reviewed-by "Nora Kim"
            :conflictcheck/reviewed-at timestamp
            :conflictcheck/notes "Firm review cleared the client for engagement"})
        link-id
        (link! conflict-for check-id client.id {})]
      true)))
(: run-conflict-check (-> Client (Action Bool)))
(define
  run-conflict-check
  [client]
  (do!
    []
    (do!
      [
        check-id
        (create!
          ConflictCheck
          {
            :conflictcheck/status "pending"
            :conflictcheck/search-terms (get client :name)
            :conflictcheck/result "not-run"
            :conflictcheck/notes "Backoffice conflicts search started"})
        link-id
        (link! conflict-for check-id client.id {})]
      true)))
(: approve-conflict-check (-> ConflictCheck Number (Action Bool)))
(define
  approve-conflict-check
  [check timestamp]
  (do!
    [
      _
      (update! ConflictCheck check.id {:conflictcheck/status "cleared"})
      _
      (update! ConflictCheck check.id {:conflictcheck/result "clear"})
      _
      (update! ConflictCheck check.id {:conflictcheck/reviewed-at timestamp})]
    true))
(: escalate-conflict-check (-> ConflictCheck (Action Bool)))
(define
  escalate-conflict-check
  [check]
  (do!
    [
      _
      (update! ConflictCheck check.id {:conflictcheck/status "needs-review"})
      _
      (emit! "escalate-conflict-check")]
    true))

;; ---------------------------------------------------------------------------
;; Engagement and Matter Opening
;; ---------------------------------------------------------------------------
(: generate-engagement-letter (-> Matter Number (Action Bool)))
(define
  generate-engagement-letter
  [matter timestamp]
  (do!
    []
    (do!
      [
        letter-id
        (create!
          EngagementLetter
          {
            :engagementletter/status "sent"
            :engagementletter/sent-at timestamp
            :engagementletter/fee-type (get matter :fee-type)
            :engagementletter/scope-summary (get matter :summary)})
        instance-id
        (instantiate! engagement-letter EngagementLetter letter-id)
        task-id
        (task!
          EngagementLetter
          {
            :title "Review and Sign Engagement Letter"
            :type "approval"
            :priority "high"
            :entity-id letter-id
            :entity-type "EngagementLetter"
            :document-ref "engagement-letter"
            :document-instance-ref instance-id
            :section-refs ["client-acceptance"]
            :assignee-role "client-contact"})
        link-id
        (link! engagement-letter-for letter-id matter.id {})]
      true)))
(: complete-engagement-letter (-> EngagementLetter Number (Action Bool)))
(define
  complete-engagement-letter
  [letter timestamp]
  (do!
    [
      _
      (update! EngagementLetter letter.id {:engagementletter/status "signed"})
      _
      (update!
        EngagementLetter
        letter.id
        {:engagementletter/signed-at timestamp})]
    true))
(:
  open-matter
  (->
    Client
    {
      :title String
      :practiceArea String
      :nextDeadline (Option Number)
      :budget (Option Number)
      :feeType (Option String)
      :summary (Option String)}
    Number
    (Action Bool)))
(define
  open-matter
  [client input timestamp]
  (do!
    [_ (update! Client client.id {:status "active"})]
    (do!
      [
        matter-id
        (create!
          Matter
          {
            :title (get input :title)
            :practice-area (get input :practiceArea)
            :status "opening"
            :opened-date timestamp
            :next-deadline (get input :nextDeadline)
            :budget (get input :budget)
            :fee-type (get input :feeType)
            :summary (get input :summary)})
        link-id
        (link! matter-for matter-id client.id {})]
      true)))
(: activate-matter (-> Matter (Action Bool)))
(define
  activate-matter
  [matter]
  (do! [_ (update! Matter matter.id {:status "active"})] true))

;; ---------------------------------------------------------------------------
;; Matter Operations
;; ---------------------------------------------------------------------------
(:
  add-case-task
  (->
    Matter
    {
      :title String
      :type String
      :priority String
      :dueDate (Option Number)
      :assigneeRole String
      :notes (Option String)}
    (Action Bool)))
(define
  add-case-task
  [matter input]
  (do!
    []
    (do!
      [
        task-id
        (create!
          CaseTask
          {
            :casetask/title (get input :title)
            :casetask/type (get input :type)
            :casetask/priority (get input :priority)
            :casetask/status "pending"
            :casetask/due-date (get input :dueDate)
            :casetask/assignee-role (get input :assigneeRole)
            :casetask/notes (get input :notes)})
        link-id
        (link! task-for-matter task-id matter.id {})]
      true)))
(: complete-case-task (-> CaseTask Number (Action Bool)))
(define
  complete-case-task
  [task timestamp]
  (do!
    [
      _
      (update! CaseTask task.id {:casetask/status "completed"})
      _
      (update! CaseTask task.id {:casetask/completed-at timestamp})]
    true))
(:
  request-documents
  (->
    Matter
    {
      :title String
      :dueDate (Option Number)
      :requestedFrom (Option String)
      :notes (Option String)}
    (Action Bool)))
(define
  request-documents
  [matter input]
  (do!
    []
    (do!
      [
        request-id
        (create!
          DocumentRequest
          {
            :documentrequest/title (get input :title)
            :documentrequest/status "requested"
            :documentrequest/due-date (get input :dueDate)
            :documentrequest/requested-from (get input :requestedFrom)
            :documentrequest/notes (get input :notes)})
        link-id
        (link! document-request-for request-id matter.id {})]
      true)))
(: mark-documents-received (-> DocumentRequest Number (Action Bool)))
(define
  mark-documents-received
  [request timestamp]
  (do!
    [
      _
      (update! DocumentRequest request.id {:documentrequest/status "received"})
      _
      (update!
        DocumentRequest
        request.id
        {:documentrequest/received-at timestamp})]
    true))

;; ---------------------------------------------------------------------------
;; Billing and Notifications
;; ---------------------------------------------------------------------------
(: approve-invoice (-> Invoice (Action Bool)))
(define
  approve-invoice
  [invoice]
  (do!
    [
      _
      (update! Invoice invoice.id {:needs-review false})
      _
      (update! Invoice invoice.id {:status "approved"})]
    true))
(: flag-client-risk (-> Client {:riskLevel String} (Action Bool)))
(define
  flag-client-risk
  [client input]
  (do! [_ (update! Client client.id {:risk-level (get input :riskLevel)})] true))
(: send-notification (-> Client (Action Bool)))
(define send-notification [client] (do! [_ (emit! "send-notification")] true))
(: escalate-to-attorney (-> Matter (Action Bool)))
(define
  escalate-to-attorney
  [matter]
  (do! [_ (emit! "escalate-to-attorney")] true))
```
