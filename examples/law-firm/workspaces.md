# Workspaces

```lisp
(export intake-coordinator managing-attorney)

;; =============================================================================
;; Law Firm Backoffice Ontology - Workspaces
;; =============================================================================
(workspace intake-coordinator
  :title "Intake Coordinator"
  :persona "Intake Coordinator"
  :subject session
  :home backoffice-dashboard
  :views
    [
      backoffice-dashboard
      client-onboarding-view
      matter-management-view
      document-requests-view
      billing-review-view
      runtime-task-detail-native])
(workspace managing-attorney
  :title "Managing Attorney"
  :persona "Attorney"
  :subject optional
  :home managing-partner-summary
  :views
    [
      managing-partner-summary
      client-portfolio-view
      high-risk-clients-view
      matter-management-view])
```
