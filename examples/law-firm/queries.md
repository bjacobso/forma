# Queries

```lisp
(export
  onboarding-clients
  active-clients
  high-risk-clients
  active-matters
  matters-opening
  intake-packets-needing-review
  pending-conflict-checks
  conflicts-needing-attorney-review
  engagement-letters-outstanding
  open-case-tasks
  urgent-case-tasks
  overdue-document-requests
  open-document-requests
  invoices-needing-review
  active-violations)

;; =============================================================================
;; Law Firm Backoffice Ontology - Queries
;; =============================================================================
(query onboarding-clients
  :from Client
  :where (= status "onboarding")
  :select [name type industry risk-level email])
(query active-clients
  :from Client
  :where (= status "active")
  :select [name type industry risk-level email])
(query high-risk-clients
  :from Client
  :where
    (match risk-level (Some __risk_level) (= __risk_level "high") None false)
  :select [name type industry status email])
(query active-matters
  :from Matter
  :where (= status "active")
  :select [title practice-area fee-type next-deadline budget])
(query matters-opening
  :from Matter
  :where (= status "opening")
  :select [title practice-area fee-type opened-date summary])
(query intake-packets-needing-review
  :from IntakePacket
  :where (= intakepacket/status "submitted")
  :select [intakepacket/status intakepacket/submitted-at intakepacket/notes])
(query pending-conflict-checks
  :from ConflictCheck
  :where (= conflictcheck/status "pending")
  :select
    [
      conflictcheck/status
      conflictcheck/search-terms
      conflictcheck/result
      conflictcheck/notes])
(query conflicts-needing-attorney-review
  :from ConflictCheck
  :where (= conflictcheck/status "needs-review")
  :select
    [
      conflictcheck/status
      conflictcheck/search-terms
      conflictcheck/result
      conflictcheck/notes])
(query engagement-letters-outstanding
  :from EngagementLetter
  :where
    (and
      (!= engagementletter/status "signed")
      (!= engagementletter/status "declined"))
  :select
    [
      engagementletter/status
      engagementletter/sent-at
      engagementletter/fee-type
      engagementletter/scope-summary])
(query open-case-tasks
  :from CaseTask
  :where (and (!= casetask/status "completed") (!= casetask/status "cancelled"))
  :select
    [
      casetask/title
      casetask/type
      casetask/priority
      casetask/status
      casetask/due-date
      casetask/assignee-role])
(query urgent-case-tasks
  :from CaseTask
  :where (and (= casetask/priority "urgent") (!= casetask/status "completed"))
  :select
    [
      casetask/title
      casetask/type
      casetask/status
      casetask/due-date
      casetask/assignee-role])
(query overdue-document-requests
  :from DocumentRequest
  :where (= documentrequest/status "overdue")
  :select
    [
      documentrequest/title
      documentrequest/requested-from
      documentrequest/due-date
      documentrequest/notes])
(query open-document-requests
  :from DocumentRequest
  :where
    (and
      (!= documentrequest/status "received")
      (!= documentrequest/status "cancelled"))
  :select
    [
      documentrequest/title
      documentrequest/status
      documentrequest/requested-from
      documentrequest/due-date])
(query invoices-needing-review
  :from Invoice
  :where (= status "draft")
  :select [number status amount issued-at due-date])
(query active-violations
  :from Violation
  :where (= status "open")
  :select [constraint-name severity message entity-id task-id detected-at])
```
