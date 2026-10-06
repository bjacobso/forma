---
id: law-firm
version: 0.1.0
preludes:
  - core
  - documents
---

# Law Firm Backoffice

Client onboarding, matter management, document chasing, and billing review for a general law firm backoffice.

```lisp
(export-from
  "./schema.md"
  [
    Attorney
    Paralegal
    Client
    Contact
    Matter
    IntakePacket
    ConflictCheck
    EngagementLetter
    CaseTask
    DocumentRequest
    Invoice
    represents
    contact-at
    intake-for
    conflict-for
    matter-for
    matter-managed-by
    matter-supported-by
    engagement-letter-for
    task-for-matter
    document-request-for
    invoice-for])
(export-from
  "./data.md"
  [
    represents
    contact-at
    intake-for
    conflict-for
    matter-for
    matter-managed-by
    matter-supported-by
    engagement-letter-for
    task-for-matter
    document-request-for
    invoice-for])
(export-from
  "./queries.md"
  [
    onboarding-clients
    active-clients
    high-risk-clients
    active-matters
    matters-opening
    intake-packets-needing-review
    pending-conflict-checks
    conflicts-needing-attorney-review
    engagement-letters-outstanding
    open-case-tasks
    urgent-case-tasks
    overdue-document-requests
    open-document-requests
    invoices-needing-review
    active-violations])
(export-from
  "./views.md"
  [
    backoffice-dashboard
    client-onboarding-view
    matter-management-view
    document-requests-view
    billing-review-view
    runtime-task-detail-native
    managing-partner-summary
    client-portfolio-view
    high-risk-clients-view])
(export-from "./workspaces.md" [intake-coordinator managing-attorney])
(export-from
  "./actions.md"
  [
    create-client
    create-intake-packet
    submit-intake-packet
    complete-firm-review
    run-conflict-check
    approve-conflict-check
    escalate-conflict-check
    generate-engagement-letter
    complete-engagement-letter
    open-matter
    activate-matter
    add-case-task
    complete-case-task
    request-documents
    mark-documents-received
    approve-invoice
    flag-client-risk
    send-notification
    escalate-to-attorney])
(export-from
  "./constraints.md"
  [
    onboarding-client-needs-conflict-check
    conflict-needs-attorney-review
    active-client-needs-attorney
    matter-needs-signed-engagement-letter
    active-matter-needs-attorney
    urgent-task-needs-owner
    overdue-document-request
    invoice-needs-review-before-sending
    high-risk-client-review])
(export-from
  "./processes.md"
  [client-onboarding matter-opening document-follow-up])
(export-from "./documents.md" [client-intake-form engagement-letter])
```

Demo story: You are an intake coordinator at Hale & Rivera LLP. You manage new prospective clients, conflict checks, engagement letters, open matters, document requests, and billing review across a small portfolio of business and individual clients.
