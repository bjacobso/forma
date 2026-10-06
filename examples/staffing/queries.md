# Queries

```lisp
(export onboarding-employees active-employees active-placements profitable-placements policy-coverage active-clients employees-rest-resource clients-rest-resource employer-review-tasks generated-documents pending-documents employer-pending-tasks onboarding-with-ids onboarding-metrics open-runtime-tasks active-violations resolved-violations)

;; =============================================================================
;; Staffing Agency Ontology - Canonical Queries
;; =============================================================================
;;
;; Canonical noun-form queries derived from the staffing example, limited to the
;; current compiler's single-entity query surface.
;;

(query onboarding-employees
  :from Employee
  :where (= status "onboarding")
  :select [first-name last-name hire-date])

(query active-employees
  :from Employee
  :where (= status "active")
  :select [first-name last-name hire-date])

(query active-placements
  :from Placement
  :where (= status "active")
  :select [pay-rate bill-rate status])

(query profitable-placements
  :from Placement
  :where (match pay-rate (Some __pay_rate) (match bill-rate (Some __bill_rate) (and
      (= status "active")
      (> __bill_rate __pay_rate)) None false) None false)
  :select [pay-rate bill-rate status])

(query policy-coverage
  :from Policy
  :where (= status "active")
  :select [name status])

(query active-clients
  :from Client
  :where (= status "active")
  :select [name industry email status])

(query employees-rest-resource
  :from Employee
  :select [first-name last-name email status hire-date])

(query clients-rest-resource
  :from Client
  :select [name industry email status])

(query employer-review-tasks
  :from Task
  :where (match entity-type (Some __entity_type) (match assigned-role (Some __assigned_role) (and
      (= __assigned_role "employer")
      (= __entity_type "Employee")
      (= status "pending")) None false) None false)
  :select [title
     priority
     status
     due-date
     completion-document-ref])

(query generated-documents
  :from Document
  :where (= status "generated")
  :select [name type status created-at])

(query pending-documents
  :from Document
  :where (= status "pending")
  :select [name type status created-at])

(query employer-pending-tasks
  :from Task
  :where (match entity-type (Some __entity_type) (match assigned-role (Some __assigned_role) (and
      (= __assigned_role "employer")
      (= __entity_type "Employee")
      (= status "pending")) None false) None false)
  :select [title
     status
     priority
     due-date
     completion-document-ref])

(query onboarding-with-ids
  :from Employee
  :where (= status "onboarding")
  :select [first-name last-name hire-date status])

(query onboarding-metrics
  :from Employee
  :where (= status "onboarding")
  :select [first-name last-name status])

(query open-runtime-tasks
  :from Task
  :where (match entity-type (Some __entity_type) (and
      (= status "pending")
      (= __entity_type "Employee")) None false)
  :select [title
     status
     priority
     entity-id
     completion-document-ref
     due-date])

(query active-violations
  :from Violation
  :where (= status "open")
  :select [constraint-name
     severity
     message
     entity-id
     task-id
     detected-at])

(query resolved-violations
  :from Violation
  :where (= status "resolved")
  :select [constraint-name
     severity
     message
     entity-id
     task-id
     detected-at
     status-changed-at
     status-changed-by])
```
