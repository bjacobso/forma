# Processes

```lisp
(export union-authorization-workflow)

;; =============================================================================
;; Labor Relations Ontology - Process
;; =============================================================================
(process union-authorization-workflow
  :description
    "CBA-triggered union authorization card workflow from placement sync to document routing"
  :trigger (on-create Placement)
  (node
    evaluate-cba-context
    :action
    start-union-authorization-card
    :input
    {:placement-id (-> context (get :entityId))})
  (node
    employee-card
    :action
    collect-form
    :input
    {:section-ids "employee-authorization" :assignee-type "entity"})
  (node create-executed-document :action submit-union-authorization-card)
  (node downstream-webhook :action emit-card-completed-webhook)
  (node route-document :action mark-document-routed)
  (edge evaluate-cba-context employee-card)
  (edge employee-card create-executed-document)
  (edge create-executed-document downstream-webhook)
  (edge downstream-webhook route-document))
```
