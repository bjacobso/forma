# Schema

```lisp
(export Address
  Employer
  Client
  Employee
  JobType
  Placement
  Policy
  OnboardingTask
  Document
  works-at
  placed-at
  serves-client
  governed-by
  assigned-task
  has-document)

;; =============================================================================
;; Staffing Agency Ontology - Canonical Schema
;; =============================================================================
;;
;; Canonical noun-form copy of the staffing schema. This preserves entity names
;; and field names from the current example while moving the surface away from
;; def-* documents and nested attribute declarations.
;;
(entity Address
  {
    :street (Option String)
    :street2 (Option String)
    :city String
    :state String
    :zip String
    :country (Option String)})
(entity Employer
  {
    :name String
    :ein (Option String :doc "Employer Identification Number")
    :phone (Option String)
    :email (Option String)
    :status String
    :address (Option (Id Address))})
(entity Client
  {
    :name String
    :industry (Option String)
    :phone (Option String)
    :email (Option String)
    :status String
    :address (Option (Id Address))})
(entity Employee
  {
    :first-name String
    :last-name String
    :email (Option String)
    :phone (Option String)
    :date-of-birth (Option String)
    :ssn (Option String :doc "Social Security Number (encrypted)")
    :i9-citizenship-status (Option String)
    :i9-section-1-signed (Option Bool)
    :status String
    :hire-date (Option Float)
    :address (Option (Id Address))})
(entity JobType
  {
    :jobtype/name String
    :jobtype/description (Option String)
    :jobtype/hourly-rate (Option Float)
    :jobtype/bill-rate (Option Float)})
(entity Placement
  {
    :start-date Float
    :end-date (Option Float)
    :status String
    :pay-rate (Option Float)
    :bill-rate (Option Float)
    :employee (Option (Id Employee))
    :client (Option (Id Client))
    :employer (Option (Id Employer))
    :job-type (Option (Id JobType))})
(entity Policy {:name String :description (Option String) :status String})
(entity OnboardingTask
  {
    :onboardingtask/title String
    :onboardingtask/document-name (Option String)
    :onboardingtask/status String
    :onboardingtask/priority String
    :onboardingtask/due-date (Option Float)
    :onboardingtask/completed-at (Option Float)
    :onboardingtask/assignee-role String
    :onboardingtask/employee (Option (Id Employee))
    :onboardingtask/placement (Option (Id Placement))
    :onboardingtask/policy (Option (Id Policy))})
(entity Document
  {
    :name String
    :type String
    :status String
    :created-at (Option Float)
    :signed-at (Option Float)
    :expires-at (Option Float)
    :source-document (Option String)
    :document-instance-id (Option String)
    :document-submission-id (Option String)
    :attachment-hash (Option String)
    :attachment-filename (Option String)
    :employee (Option (Id Employee))})
(relation works-at
  Employee
  Employer
  {:start-date (Option Float) :end-date (Option Float) :status (Option String)})
(relation placed-at
  Employee
  Client
  {
    :start-date (Option Float)
    :end-date (Option Float)
    :employer (Option String)
    :jobtype (Option String)
    :status (Option String)})
(relation serves-client
  Employer
  Client
  {:since (Option Float) :contract-type (Option String)})
(relation governed-by
  Employer
  Policy
  {:since (Option Float) :overridden (Option Bool)})
(relation assigned-task Employee OnboardingTask {:assigned-at (Option Float)})
(relation has-document Employee Document {:uploaded-at (Option Float)})
```

```

```
