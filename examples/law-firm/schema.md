# Schema

```lisp
(export
  Attorney
  Paralegal
  Client
  Contact
  Matter
  IntakePacket
  ConflictCheck
  EngagementLetter
  CaseTask
  DocumentRequest
  Invoice
  represents
  contact-at
  intake-for
  conflict-for
  matter-for
  matter-managed-by
  matter-supported-by
  engagement-letter-for
  task-for-matter
  document-request-for
  invoice-for)

;; =============================================================================
;; Law Firm Backoffice Ontology - Schema
;; =============================================================================
;;
;; Models a general law firm backoffice focused on client onboarding, conflict
;; checks, engagement letters, matter management, document requests, and billing.
;;
;; ---------------------------------------------------------------------------
;; Entity Types
;; ---------------------------------------------------------------------------
(entity Attorney
  {
    :first-name String
    :last-name String
    :email String
    :phone (Option String)
    :bar-number String
    :practice-area (Option String)
    :status String})
(entity Paralegal
  {
    :first-name String
    :last-name String
    :email String
    :team (Option String)
    :status String})
(entity Client
  {
    :name String
    :type String
    :industry (Option String)
    :phone (Option String)
    :email (Option String)
    :status String
    :risk-level (Option String)
    :source (Option String)})
(entity Contact
  {
    :name String
    :title (Option String)
    :email String
    :phone (Option String)
    :role String})
(entity Matter
  {
    :title String
    :practice-area String
    :status String
    :opened-date (Option Number)
    :next-deadline (Option Number)
    :budget (Option Number)
    :fee-type (Option String)
    :summary (Option String)})
(entity IntakePacket
  {
    :intakepacket/status String
    :intakepacket/submitted-at (Option Number)
    :intakepacket/reviewed-at (Option Number)
    :intakepacket/notes (Option String)})
(entity ConflictCheck
  {
    :conflictcheck/status String
    :conflictcheck/search-terms (Option String)
    :conflictcheck/result (Option String)
    :conflictcheck/reviewed-by (Option String)
    :conflictcheck/reviewed-at (Option Number)
    :conflictcheck/notes (Option String)})
(entity EngagementLetter
  {
    :engagementletter/status String
    :engagementletter/sent-at (Option Number)
    :engagementletter/signed-at (Option Number)
    :engagementletter/fee-type (Option String)
    :engagementletter/scope-summary (Option String)})
(entity CaseTask
  {
    :casetask/title String
    :casetask/type String
    :casetask/priority String
    :casetask/status String
    :casetask/due-date (Option Number)
    :casetask/completed-at (Option Number)
    :casetask/assignee-role String
    :casetask/notes (Option String)})
(entity DocumentRequest
  {
    :documentrequest/title String
    :documentrequest/status String
    :documentrequest/due-date (Option Number)
    :documentrequest/received-at (Option Number)
    :documentrequest/requested-from (Option String)
    :documentrequest/notes (Option String)})
(entity Invoice
  {
    :number String
    :status String
    :amount Number
    :issued-at (Option Number)
    :due-date (Option Number)
    :needs-review (Option Bool)})

;; ---------------------------------------------------------------------------
;; Relations
;; ---------------------------------------------------------------------------
(relation represents Attorney Client
  {:since (Option Number) :role (Option String)})
(relation contact-at Contact Client {:primary (Option Bool)})
(relation intake-for IntakePacket Client {})
(relation conflict-for ConflictCheck Client {})
(relation matter-for Matter Client {})
(relation matter-managed-by Matter Attorney {})
(relation matter-supported-by Matter Paralegal {})
(relation engagement-letter-for EngagementLetter Matter {})
(relation task-for-matter CaseTask Matter {})
(relation document-request-for DocumentRequest Matter {})
(relation invoice-for Invoice Matter {})
```
