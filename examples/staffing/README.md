---
id: staffing
version: 0.1.0
preludes:
  - core
  - documents
---

# Staffing Agency

Canonical staffing example as a multi-file markdown ontology.

```lisp
(export-from
  "./schema.md"
  [
    Address
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
    has-document])
(export-from
  "./data.md"
  [works-at placed-at serves-client governed-by assigned-task has-document])
(export-from
  "./queries.md"
  [
    onboarding-employees
    active-employees
    active-placements
    profitable-placements
    policy-coverage
    active-clients
    employees-rest-resource
    clients-rest-resource
    employer-review-tasks
    generated-documents
    pending-documents
    employer-pending-tasks
    onboarding-with-ids
    onboarding-metrics
    open-runtime-tasks
    active-violations
    resolved-violations])
(export-from
  "./views.md"
  [
    onboarding-workers-view
    employer-review-queue-view
    generated-documents-view
    pending-documents-view
    employees-rest-resource-view
    clients-rest-resource-view
    onboarding-dashboard
    onboarding-tracker
    employer-inbox
    runtime-task-queue-view
    active-violations-view
    resolved-violations-view
    i9-submission-mapping-view
    employee-profile-dashboard
    runtime-task-detail-native
    violation-detail-native
    active-client-portfolio-view
    profitable-active-placements])
(export-from
  "./workspaces.md"
  [onboarding-operations account-portfolio employee-profile staffing-api-access])
(import "./tasks.md" :as tasks)
(export-from
  "./actions.md"
  [
    hire-employee
    hire-existing-employee
    generate-onboarding-tasks
    start-i9
    create-bgc-task
    complete-onboarding
    collect-form
    evaluate-condition
    send-notification
    generate-i9-pdf
    start-i9-section-2
    complete-w4-task
    complete-bgc-task
    complete-direct-deposit-task
    complete-handbook-task
    complete-state-tax-task
    complete-idv-task
    mark-compliant])
(export-from
  "./constraints.md"
  [
    employee-email-required
    placement-missing-employer
    placement-missing-client
    onboarding-employee-no-placement
    onboarding-no-tasks
    onboarding-missing-i9
    employee-missing-bgc
    all-tasks-complete
    onboarding-overdue-critical
    onboarding-overdue-standard
    expired-documents])
(export-from "./processes.md" [employee-onboarding])
(export-from
  "./documents.md"
  [
    i-9-employment-eligibility
    w-4-federal-tax-withholding
    employee-handbook-acknowledgement
    direct-deposit-authorization
    state-tax-withholding
    background-check-consent
    identity-document-verification])
(export-from "./pdf-mappings.md" [i9-pdf])
```

This example keeps the full staffing domain in markdown, but splits the source by concern so the IDE, API, and tests exercise canonical multi-file loading.
