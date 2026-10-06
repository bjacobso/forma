# Constraints

```lisp
(export
  covered-placement-needs-card-task
  pending-card-needs-active-template
  rehire-needs-lr-review)

;; =============================================================================
;; Labor Relations Ontology - Constraints
;; =============================================================================
(constraint covered-placement-needs-card-task
  :entity Placement
  :description "Covered placements need a union authorization task"
  :category "labor-relations"
  :severity :error
  :query
    ((find ?placement ?cbaId)
      (where
        [?placement :_schema/type "Placement"]
        [?placement :placement/status "covered-pending-card"]
        [?placement :placement/cba-id ?cbaId]
        [not [?task :unionauthtask/placement ?placement]]))
  :message
    (format "Covered placement for CBA {} has no authorization task" ?cbaId))
(constraint pending-card-needs-active-template
  :entity UnionAuthorizationTask
  :description
    "Open authorization tasks should reference an approved template version"
  :category "template-governance"
  :severity :warning
  :query
    ((find ?task ?title ?version)
      (where
        [?task :_schema/type "UnionAuthorizationTask"]
        [?task :unionauthtask/status "needs-review"]
        [?task :unionauthtask/title ?title]
        [?task :unionauthtask/template-version ?version]))
  :message
    (format
      "Authorization task \"{}\" is waiting on template version {} review"
      ?title
      ?version))
(constraint rehire-needs-lr-review
  :entity Employee
  :description
    "Returning workers require labor-relations policy review before skipping a card"
  :category "rehire"
  :severity :info
  :query
    ((find ?employee ?firstName ?lastName ?globalHrId)
      (where
        [?employee :_schema/type "Employee"]
        [?employee :employee/rehire-indicator true]
        [?employee :employee/first-name ?firstName]
        [?employee :employee/last-name ?lastName]
        [?employee :employee/global-hr-id ?globalHrId]))
  :message
    (format
      "Rehire {} {} ({}) needs union-card reuse policy review"
      ?firstName
      ?lastName
      ?globalHrId)
  (resolution "Flag Rehire Review" flag-rehire-review :auto false))
```
