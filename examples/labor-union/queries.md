# Queries

```lisp
(export covered-placements pending-authorization-tasks completed-authorization-documents active-cba-templates all-cba-templates cbas-needing-review rehire-review-cases integration-events routing-exceptions employees-in-preboarding)

;; =============================================================================
;; Labor Relations Ontology - Queries
;; =============================================================================

(query covered-placements
  :from Placement
  :where (match cba-id (Some __cba_id) (and
      (!= status "cancelled")
      (!= __cba_id "")) None false)
  :select [start-date status source-system cba-id employee position])

(query pending-authorization-tasks
  :from UnionAuthorizationTask
  :where (and
      (!= unionauthtask/status "completed")
      (!= unionauthtask/status "cancelled"))
  :select [unionauthtask/title unionauthtask/status unionauthtask/priority unionauthtask/assignee-role unionauthtask/due-date unionauthtask/template-version])

(query completed-authorization-documents
  :from ExecutedAuthorizationDocument
  :where (= executeddocument/status "available")
  :select [executeddocument/name executeddocument/signed-at executeddocument/template-version executeddocument/routing-status executeddocument/pdf-reference])

(query active-cba-templates
  :from AuthorizationCardTemplate
  :where (= authcardtemplate/status "active")
  :select [authcardtemplate/template-id authcardtemplate/name authcardtemplate/version authcardtemplate/source-system authcardtemplate/form-mode])

(query all-cba-templates
  :from AuthorizationCardTemplate
  :select [authcardtemplate/template-id authcardtemplate/name authcardtemplate/version authcardtemplate/status authcardtemplate/form-mode])

(query cbas-needing-review
  :from CollectiveBargainingAgreement
  :where (!= cba/status "active")
  :select [cba/identifier cba/union-name cba/local-label cba/status cba/geographic-scope])

(query rehire-review-cases
  :from Employee
  :where (match cba-id (Some __cba_id) (= __cba_id "CBA-HSP-311-2026") None false)
  :select [first-name last-name status global-hr-id cba-id union-card-signed])

(query integration-events
  :from IntegrationEvent
  :select [integrationevent/event-type integrationevent/status integrationevent/target-system integrationevent/emitted-at integrationevent/payload-summary])

(query routing-exceptions
  :from ExecutedAuthorizationDocument
  :where (match executeddocument/routing-status (Some __executeddocument_routing_status) (!= __executeddocument_routing_status "routed") None false)
  :select [executeddocument/name executeddocument/status executeddocument/routing-status executeddocument/pdf-reference])

(query employees-in-preboarding
  :from Employee
  :where (= status "preboarding")
  :select [first-name last-name email global-hr-id cba-id rehire-indicator])
```
