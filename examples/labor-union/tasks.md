# Tasks

```lisp
;; =============================================================================
;; Labor Relations Ontology - Task Definitions
;; =============================================================================
(task complete-union-authorization-card {:employee Employee}
  :title "Complete Union Authorization Card"
  :description
    "Employee reviews prefilled CBA context, acknowledges authorization language, and signs the card."
  :scope Employee
  :document union-authorization-card
  :default-assignee employee
  :sections [employee-authorization])
(task review-rehire-authorization-policy {:employee Employee}
  :title "Review Rehire Authorization Policy"
  :description
    "Labor relations reviews whether an existing signed card can be reused or a new card must be executed."
  :scope Employee
  :default-assignee labor-relations)
```
