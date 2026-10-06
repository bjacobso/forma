# Workspaces

```lisp
(export onboarding-operations account-portfolio employee-profile staffing-api-access)

;; =============================================================================
;; Staffing Agency Ontology - Workspaces
;; =============================================================================
;;
;; Flat workspace declarations. The runtime auto-generates navigation from the
;; workspace view list using each view's title as the nav label.
;;

(workspace onboarding-operations :title "Onboarding Operations" :persona "Onboarding Coordinator" :subject session :home onboarding-dashboard :views [onboarding-dashboard onboarding-tracker employer-inbox runtime-task-queue-view onboarding-workers-view employer-review-queue-view active-violations-view resolved-violations-view i9-submission-mapping-view runtime-task-detail-native violation-detail-native generated-documents-view pending-documents-view])

(workspace account-portfolio :title "Account Portfolio" :persona "Account Manager" :subject optional :home active-client-portfolio-view :views [active-client-portfolio-view profitable-active-placements])

(workspace employee-profile :title "Employee Profile" :persona "Employee" :subject required :home employee-profile-dashboard :views [employee-profile-dashboard])

(workspace staffing-api-access :title "Staffing API Access" :persona "Integration Developer" :subject session :home employees-rest-resource-view :views [employees-rest-resource-view clients-rest-resource-view])
```
