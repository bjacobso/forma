---
id: labor-union
version: 0.1.0
preludes:
  - core
  - documents
---

# Labor Relations

```lisp
(export-from
  "./schema.md"
  [
    Employer
    SectorBrand
    WorkLocation
    Employee
    Position
    Placement
    CollectiveBargainingAgreement
    AuthorizationCardTemplate
    UnionAuthorizationTask
    ExecutedAuthorizationDocument
    IntegrationEvent
    brand-of
    location-for
    placed-in
    placement-position
    placement-employer
    position-covered-by
    cba-uses-template
    task-for-placement
    task-fulfills-cba
    task-produces-document
    event-for-document])
(export-from
  "./data.md"
  [
    brand-of
    location-for
    position-covered-by
    cba-uses-template
    placed-in
    placement-position
    placement-employer
    task-for-placement
    task-fulfills-cba
    task-produces-document
    event-for-document])
(export-from
  "./queries.md"
  [
    covered-placements
    pending-authorization-tasks
    completed-authorization-documents
    active-cba-templates
    all-cba-templates
    cbas-needing-review
    rehire-review-cases
    integration-events
    routing-exceptions
    employees-in-preboarding])
(export-from
  "./views.md"
  [
    lr-dashboard
    covered-placement-queue
    authorization-task-queue
    cba-template-library
    rehire-review
    document-routing-monitor
    integration-events-view
    employee-card-dashboard])
(export-from
  "./workspaces.md"
  [labor-relations-operations employee-card-experience integration-monitor])
(import "./tasks.md" :as tasks)
(export-from
  "./actions.md"
  [
    create-covered-placement
    sync-employee-cba-attribute
    start-union-authorization-card
    collect-form
    submit-union-authorization-card
    emit-card-completed-webhook
    mark-document-routed
    flag-rehire-review])
(export-from
  "./constraints.md"
  [
    covered-placement-needs-card-task
    pending-card-needs-active-template
    rehire-needs-lr-review])
(export-from "./processes.md" [union-authorization-workflow])
(export-from "./documents.md" [union-authorization-card])
```

This client-neutral example models a labor-relations union authorization card workflow. A covered placement arrives from an HRIS or requisition feed, the ontology evaluates CBA context, creates the correct authorization task, captures a signed mobile form, and exposes the completed document for downstream routing.
