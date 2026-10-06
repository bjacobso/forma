# Workspaces

```lisp
(export labor-relations-operations employee-card-experience integration-monitor)

;; =============================================================================
;; Labor Relations Ontology - Workspaces
;; =============================================================================

(workspace labor-relations-operations :title "Labor Relations Operations" :persona "Labor Relations Coordinator" :subject session :home lr-dashboard :views [lr-dashboard covered-placement-queue authorization-task-queue cba-template-library rehire-review document-routing-monitor integration-events-view])

(workspace employee-card-experience :title "Employee Card Experience" :persona "Employee" :subject required :home employee-card-dashboard :views [employee-card-dashboard])

(workspace integration-monitor :title "Integration Monitor" :persona "Integration Operator" :subject session :home integration-events-view :views [integration-events-view document-routing-monitor cba-template-library])
```
