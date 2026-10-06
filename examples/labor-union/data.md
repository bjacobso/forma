# Seed Data

```lisp
(export
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
  event-for-document)

;; =============================================================================
;; Labor Relations Ontology - Seed Data
;; =============================================================================
(seed Employer "employer:northstar"
  {
    :name "Northstar Hospitality Group"
    :status "active"
    :repository-profile "Associate Digital File"
    :default-delivery-channel "Candidate Messaging"})
(seed SectorBrand "brand:stadium-dining"
  {
    :sectorbrand/name "stadium-dining"
    :sectorbrand/display-name "Stadium Dining"
    :sectorbrand/branding-mode "sector-brand"
    :sectorbrand/status "active"})
(seed SectorBrand "brand:campus-kitchens"
  {
    :sectorbrand/name "campus-kitchens"
    :sectorbrand/display-name "Campus Kitchens"
    :sectorbrand/branding-mode "sector-brand"
    :sectorbrand/status "active"})
(seed WorkLocation "location:riverfront-arena"
  {
    :worklocation/name "Riverfront Arena"
    :worklocation/sector "sports-and-entertainment"
    :worklocation/city "Cleveland"
    :worklocation/state "OH"
    :worklocation/status "active"})
(seed WorkLocation "location:west-campus"
  {
    :worklocation/name "West Campus Dining"
    :worklocation/sector "education"
    :worklocation/city "Madison"
    :worklocation/state "WI"
    :worklocation/status "active"})
(seed AuthorizationCardTemplate "template:food-service-204-v3"
  {
    :authcardtemplate/template-id "AUTH-FS-204"
    :authcardtemplate/name "Food Service Workers Authorization Card"
    :authcardtemplate/version "v3"
    :authcardtemplate/status "active"
    :authcardtemplate/source-system "CBA MDM"
    :authcardtemplate/source-reference "mdm://templates/AUTH-FS-204/v3"
    :authcardtemplate/form-mode "simplified"
    :authcardtemplate/disclosure-summary
      "Employee authorizes union representation and payroll dues deduction for the covered bargaining unit."})
(seed AuthorizationCardTemplate "template:hospitality-311-v1"
  {
    :authcardtemplate/template-id "AUTH-HSP-311"
    :authcardtemplate/name "Hospitality Local Authorization Card"
    :authcardtemplate/version "v1"
    :authcardtemplate/status "draft"
    :authcardtemplate/source-system "CBA MDM"
    :authcardtemplate/source-reference "mdm://templates/AUTH-HSP-311/v1"
    :authcardtemplate/form-mode "verbatim"
    :authcardtemplate/disclosure-summary
      "Legal review requires verbatim card content before publication."})
(seed CollectiveBargainingAgreement "cba:food-service-204"
  {
    :cba/identifier "CBA-FS-204-2026"
    :cba/union-name "Food Service Workers Alliance"
    :cba/local-label "Local 204 Food Service Workers"
    :cba/sector "sports-and-entertainment"
    :cba/geographic-scope "Ohio arena accounts"
    :cba/effective-start 1767225600000
    :cba/effective-end 1861833600000
    :cba/status "active"
    :cba/card-template "template:food-service-204-v3"})
(seed CollectiveBargainingAgreement "cba:hospitality-311"
  {
    :cba/identifier "CBA-HSP-311-2026"
    :cba/union-name "Hospitality Staff Guild"
    :cba/local-label "Local 311 Hospitality Staff"
    :cba/sector "education"
    :cba/geographic-scope "Upper Midwest campus accounts"
    :cba/effective-start 1767225600000
    :cba/effective-end 1861833600000
    :cba/status "pending-review"
    :cba/card-template "template:hospitality-311-v1"})
(seed Position "position:arena-cashier"
  {
    :title "Concessions Cashier"
    :job-code "FS-1007"
    :status "open"
    :cba-id "CBA-FS-204-2026"
    :sector-brand "brand:stadium-dining"
    :work-location "location:riverfront-arena"})
(seed Position "position:campus-cook"
  {
    :title "Campus Line Cook"
    :job-code "CK-2204"
    :status "open"
    :cba-id "CBA-HSP-311-2026"
    :sector-brand "brand:campus-kitchens"
    :work-location "location:west-campus"})
(seed Employee "employee:maya-chen"
  {
    :first-name "Maya"
    :last-name "Chen"
    :email "maya.chen@example.com"
    :phone "+1-216-555-0142"
    :status "preboarding"
    :global-hr-id "GHR-00014822"
    :hire-event-id "HIRE-2026-0419"
    :rehire-indicator false
    :address "142 Market Street, Cleveland, OH"
    :union-card-signed false})
(seed Employee "employee:darius-lee"
  {
    :first-name "Darius"
    :last-name "Lee"
    :email "darius.lee@example.com"
    :phone "+1-608-555-0184"
    :status "preboarding"
    :global-hr-id "GHR-00009210"
    :hire-event-id "HIRE-2026-0427"
    :rehire-indicator true
    :cba-id "CBA-HSP-311-2026"
    :address "88 Lake Avenue, Madison, WI"
    :union-card-signed false})
(seed Employee "employee:rosa-diaz"
  {
    :first-name "Rosa"
    :last-name "Diaz"
    :email "rosa.diaz@example.com"
    :phone "+1-216-555-0199"
    :status "active"
    :global-hr-id "GHR-00005218"
    :hire-event-id "HIRE-2025-0931"
    :rehire-indicator false
    :cba-id "CBA-FS-204-2026"
    :address "301 Ontario Avenue, Cleveland, OH"
    :union-card-signed true})
(seed Placement "placement:maya-arena"
  {
    :start-date 1770163200000
    :status "covered-pending-card"
    :source-system "Enterprise HRIS"
    :cba-id "CBA-FS-204-2026"
    :employee "employee:maya-chen"
    :position "position:arena-cashier"
    :employer "employer:northstar"})
(seed Placement "placement:darius-campus"
  {
    :start-date 1770768000000
    :status "rehire-review"
    :source-system "Enterprise HRIS"
    :cba-id "CBA-HSP-311-2026"
    :employee "employee:darius-lee"
    :position "position:campus-cook"
    :employer "employer:northstar"})
(seed Placement "placement:rosa-arena"
  {
    :start-date 1757894400000
    :status "active"
    :source-system "Enterprise HRIS"
    :cba-id "CBA-FS-204-2026"
    :employee "employee:rosa-diaz"
    :position "position:arena-cashier"
    :employer "employer:northstar"})
(seed UnionAuthorizationTask "union-task:maya-card"
  {
    :unionauthtask/title "Complete Food Service Workers authorization card"
    :unionauthtask/status "pending"
    :unionauthtask/priority "critical"
    :unionauthtask/assignee-role "employee"
    :unionauthtask/delivery-channel "Candidate Messaging"
    :unionauthtask/due-date 1770076800000
    :unionauthtask/template-version "v3"
    :unionauthtask/employee "employee:maya-chen"
    :unionauthtask/placement "placement:maya-arena"
    :unionauthtask/cba "cba:food-service-204"})
(seed UnionAuthorizationTask "union-task:darius-review"
  {
    :unionauthtask/title "Review rehire union authorization policy"
    :unionauthtask/status "needs-review"
    :unionauthtask/priority "high"
    :unionauthtask/assignee-role "labor-relations"
    :unionauthtask/delivery-channel "Labor Relations Queue"
    :unionauthtask/due-date 1770249600000
    :unionauthtask/template-version "v1"
    :unionauthtask/employee "employee:darius-lee"
    :unionauthtask/placement "placement:darius-campus"
    :unionauthtask/cba "cba:hospitality-311"})
(seed UnionAuthorizationTask "union-task:rosa-card"
  {
    :unionauthtask/title "Completed Food Service Workers authorization card"
    :unionauthtask/status "completed"
    :unionauthtask/priority "critical"
    :unionauthtask/assignee-role "employee"
    :unionauthtask/delivery-channel "Candidate Messaging"
    :unionauthtask/due-date 1757808000000
    :unionauthtask/completed-at 1757721600000
    :unionauthtask/template-version "v3"
    :unionauthtask/document-instance-id "docinst:rosa-card"
    :unionauthtask/employee "employee:rosa-diaz"
    :unionauthtask/placement "placement:rosa-arena"
    :unionauthtask/cba "cba:food-service-204"})
(seed ExecutedAuthorizationDocument "executed:rosa-card"
  {
    :executeddocument/name "Rosa Diaz - Union Authorization Card"
    :executeddocument/status "available"
    :executeddocument/signed-at 1757721600000
    :executeddocument/template-version "v3"
    :executeddocument/pdf-reference "api://documents/docinst:rosa-card/pdf"
    :executeddocument/structured-data-reference
      "api://documents/docinst:rosa-card/data"
    :executeddocument/routing-status "routed"
    :executeddocument/task "union-task:rosa-card"
    :executeddocument/employee "employee:rosa-diaz"
    :executeddocument/cba "cba:food-service-204"})
(seed IntegrationEvent "event:rosa-card-complete"
  {
    :integrationevent/event-type "task_updated"
    :integrationevent/status "delivered"
    :integrationevent/target-system "Associate Digital File"
    :integrationevent/emitted-at 1757721660000
    :integrationevent/payload-summary
      "Union authorization task reached 100% completion; PDF and structured data ready for retrieval."
    :integrationevent/task "union-task:rosa-card"
    :integrationevent/document "executed:rosa-card"
    :integrationevent/employee "employee:rosa-diaz"})
(link brand-of "brand:stadium-dining" "employer:northstar" {})
(link brand-of "brand:campus-kitchens" "employer:northstar" {})
(link location-for "location:riverfront-arena" "brand:stadium-dining" {})
(link location-for "location:west-campus" "brand:campus-kitchens" {})
(link position-covered-by "position:arena-cashier" "cba:food-service-204" {})
(link position-covered-by "position:campus-cook" "cba:hospitality-311" {})
(link cba-uses-template "cba:food-service-204" "template:food-service-204-v3" {})
(link cba-uses-template "cba:hospitality-311" "template:hospitality-311-v1" {})
(link placed-in "employee:maya-chen" "placement:maya-arena" {})
(link placed-in "employee:darius-lee" "placement:darius-campus" {})
(link placed-in "employee:rosa-diaz" "placement:rosa-arena" {})
(link placement-position "placement:maya-arena" "position:arena-cashier" {})
(link placement-position "placement:darius-campus" "position:campus-cook" {})
(link placement-position "placement:rosa-arena" "position:arena-cashier" {})
(link placement-employer "placement:maya-arena" "employer:northstar" {})
(link placement-employer "placement:darius-campus" "employer:northstar" {})
(link placement-employer "placement:rosa-arena" "employer:northstar" {})
(link task-for-placement "union-task:maya-card" "placement:maya-arena" {})
(link task-for-placement "union-task:darius-review" "placement:darius-campus" {})
(link task-for-placement "union-task:rosa-card" "placement:rosa-arena" {})
(link task-fulfills-cba "union-task:maya-card" "cba:food-service-204" {})
(link task-fulfills-cba "union-task:darius-review" "cba:hospitality-311" {})
(link task-fulfills-cba "union-task:rosa-card" "cba:food-service-204" {})
(link task-produces-document "union-task:rosa-card" "executed:rosa-card" {})
(link event-for-document "event:rosa-card-complete" "executed:rosa-card" {})
```
