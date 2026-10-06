# Schema

```lisp
(export
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
  event-for-document)

;; =============================================================================
;; Labor Relations Ontology - Schema
;; =============================================================================
;;
;; Client-neutral model for CBA-triggered union authorization card workflow.
;;
(entity Employer
  {
    :name String
    :status String
    :repository-profile (Option String)
    :default-delivery-channel (Option String)})
(entity SectorBrand
  {
    :sectorbrand/name String
    :sectorbrand/display-name (Option String)
    :sectorbrand/branding-mode (Option String)
    :sectorbrand/status String})
(entity WorkLocation
  {
    :worklocation/name String
    :worklocation/sector (Option String)
    :worklocation/city (Option String)
    :worklocation/state (Option String)
    :worklocation/status String})
(entity Employee
  {
    :first-name String
    :last-name String
    :email (Option String)
    :phone (Option String)
    :status String
    :global-hr-id (Option String)
    :hire-event-id (Option String)
    :rehire-indicator (Option Bool)
    :cba-id (Option String)
    :address (Option String)
    :union-card-signed (Option Bool)})
(entity Position
  {
    :title String
    :job-code String
    :status String
    :cba-id (Option String)
    :sector-brand (Option (Id SectorBrand))
    :work-location (Option (Id WorkLocation))})
(entity Placement
  {
    :start-date Number
    :status String
    :source-system (Option String)
    :cba-id (Option String)
    :employee (Option (Id Employee))
    :position (Option (Id Position))
    :employer (Option (Id Employer))})
(entity CollectiveBargainingAgreement
  {
    :cba/identifier String
    :cba/union-name String
    :cba/local-label (Option String)
    :cba/sector (Option String)
    :cba/geographic-scope (Option String)
    :cba/effective-start (Option Number)
    :cba/effective-end (Option Number)
    :cba/status String
    :cba/card-template (Option (Id AuthorizationCardTemplate))})
(entity AuthorizationCardTemplate
  {
    :authcardtemplate/template-id String
    :authcardtemplate/name String
    :authcardtemplate/version String
    :authcardtemplate/status String
    :authcardtemplate/source-system (Option String)
    :authcardtemplate/source-reference (Option String)
    :authcardtemplate/form-mode (Option String)
    :authcardtemplate/disclosure-summary (Option String)})
(entity UnionAuthorizationTask
  {
    :unionauthtask/title String
    :unionauthtask/status String
    :unionauthtask/priority (Option String)
    :unionauthtask/assignee-role (Option String)
    :unionauthtask/delivery-channel (Option String)
    :unionauthtask/due-date (Option Number)
    :unionauthtask/completed-at (Option Number)
    :unionauthtask/template-version (Option String)
    :unionauthtask/runtime-task-id (Option String)
    :unionauthtask/document-instance-id (Option String)
    :unionauthtask/employee (Option (Id Employee))
    :unionauthtask/placement (Option (Id Placement))
    :unionauthtask/cba (Option (Id CollectiveBargainingAgreement))})
(entity ExecutedAuthorizationDocument
  {
    :executeddocument/name String
    :executeddocument/status String
    :executeddocument/signed-at (Option Number)
    :executeddocument/template-version (Option String)
    :executeddocument/pdf-reference (Option String)
    :executeddocument/structured-data-reference (Option String)
    :executeddocument/routing-status (Option String)
    :executeddocument/task (Option (Id UnionAuthorizationTask))
    :executeddocument/employee (Option (Id Employee))
    :executeddocument/cba (Option (Id CollectiveBargainingAgreement))})
(entity IntegrationEvent
  {
    :integrationevent/event-type String
    :integrationevent/status String
    :integrationevent/target-system (Option String)
    :integrationevent/emitted-at (Option Number)
    :integrationevent/payload-summary (Option String)
    :integrationevent/task (Option (Id UnionAuthorizationTask))
    :integrationevent/document (Option (Id ExecutedAuthorizationDocument))
    :integrationevent/employee (Option (Id Employee))})
(relation brand-of SectorBrand Employer {})
(relation location-for WorkLocation SectorBrand {})
(relation placed-in Employee Placement {})
(relation placement-position Placement Position {})
(relation placement-employer Placement Employer {})
(relation position-covered-by Position CollectiveBargainingAgreement {})
(relation cba-uses-template CollectiveBargainingAgreement
  AuthorizationCardTemplate
  {})
(relation task-for-placement UnionAuthorizationTask Placement {})
(relation task-fulfills-cba UnionAuthorizationTask CollectiveBargainingAgreement
  {})
(relation task-produces-document UnionAuthorizationTask
  ExecutedAuthorizationDocument
  {})
(relation event-for-document IntegrationEvent ExecutedAuthorizationDocument {})
```
