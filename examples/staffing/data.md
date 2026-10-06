# Seed Data

```lisp
(export works-at placed-at serves-client governed-by assigned-task has-document)

;; =============================================================================
;; Staffing Agency Ontology - Entities (Seed Data)
;; =============================================================================
;;
;; 41 record instances + 29 link instances.
;; Timestamps use fixed epoch ms values.
;;

;; ---------------------------------------------------------------------------
;; Addresses
;; ---------------------------------------------------------------------------

(seed Address "addr:employer-hq" {:street "100 Staffing Plaza"
  :city "Austin"
  :state "TX"
  :zip "78701"
  :country "USA"})

(seed Address "addr:client-techcorp" {:street "200 Tech Drive"
  :city "San Francisco"
  :state "CA"
  :zip "94102"
  :country "USA"})

(seed Address "addr:client-retail" {:street "300 Commerce Way"
  :city "Dallas"
  :state "TX"
  :zip "75201"
  :country "USA"})

(seed Address "addr:emp-alice" {:street "123 Main St"
  :city "Austin"
  :state "TX"
  :zip "78702"
  :country "USA"})

;; ---------------------------------------------------------------------------
;; Employers (Staffing Agencies)
;; ---------------------------------------------------------------------------

(seed Employer "employer:acme" {:name "Acme Staffing"
  :ein "12-3456789"
  :phone "+1-512-555-0100"
  :email "hr@acmestaffing.com"
  :status "active"
  :address "addr:employer-hq"})

(seed Employer "employer:premier" {:name "Premier Workforce"
  :ein "98-7654321"
  :phone "+1-512-555-0200"
  :email "hr@premierworkforce.com"
  :status "active"})

;; ---------------------------------------------------------------------------
;; Clients (End Employers)
;; ---------------------------------------------------------------------------

(seed Client "client:techcorp" {:name "TechCorp Industries"
  :industry "Technology"
  :phone "+1-415-555-0100"
  :email "staffing@techcorp.com"
  :status "active"
  :address "addr:client-techcorp"})

(seed Client "client:retail-giant" {:name "Retail Giant Inc"
  :industry "Retail"
  :phone "+1-214-555-0100"
  :email "hr@retailgiant.com"
  :status "active"
  :address "addr:client-retail"})

(seed Client "client:healthcare" {:name "Healthcare Plus"
  :industry "Healthcare"
  :phone "+1-512-555-0300"
  :email "staffing@healthcareplus.com"
  :status "prospect"})

;; ---------------------------------------------------------------------------
;; Job Types
;; ---------------------------------------------------------------------------

(seed JobType "job:software-dev" {:jobtype/name "Software Developer"
  :jobtype/description "Full-stack software development"
  :jobtype/hourly-rate 75
  :jobtype/bill-rate 125})

(seed JobType "job:warehouse" {:jobtype/name "Warehouse Associate"
  :jobtype/description "General warehouse operations"
  :jobtype/hourly-rate 18
  :jobtype/bill-rate 28})

(seed JobType "job:admin" {:jobtype/name "Administrative Assistant"
  :jobtype/description "Office administrative support"
  :jobtype/hourly-rate 22
  :jobtype/bill-rate 35})

(seed JobType "job:nurse" {:jobtype/name "Registered Nurse"
  :jobtype/description "Healthcare nursing services"
  :jobtype/hourly-rate 45
  :jobtype/bill-rate 75})

;; ---------------------------------------------------------------------------
;; Employees (Workers)
;; ---------------------------------------------------------------------------

(seed Employee "emp:alice" {:first-name "Alice"
  :last-name "Johnson"
  :email "alice.johnson@email.com"
  :phone "+1-512-555-1001"
  :status "active"
  :hire-date 1672531200000
  :address "addr:emp-alice"})

(seed Employee "emp:bob" {:first-name "Bob"
  :last-name "Williams"
  :email "bob.williams@email.com"
  :phone "+1-512-555-1002"
  :status "active"
  :hire-date 1688515200000})

(seed Employee "emp:carol" {:first-name "Carol"
  :last-name "Martinez"
  :email "carol.martinez@email.com"
  :phone "+1-512-555-1003"
  :status "active"
  :hire-date 1696291200000})

(seed Employee "emp:david" {:first-name "David"
  :last-name "Chen"
  :email "david.chen@email.com"
  :status "onboarding"
  :hire-date 1704067200000})

(seed Employee "emp:emma" {:first-name "Emma"
  :last-name "Garcia"
  :email "emma.garcia@email.com"
  :status "onboarding"
  :hire-date 1704240000000})

(seed Employee "emp:frank" {:first-name "Frank"
  :last-name "Brown"
  :email "frank.brown@email.com"
  :status "inactive"
  :hire-date 1660348800000})

;; ---------------------------------------------------------------------------
;; Placements
;; ---------------------------------------------------------------------------

(seed Placement "placement:alice-techcorp" {:start-date 1672531200000
  :status "active"
  :pay-rate 75
  :bill-rate 125
  :employee "emp:alice"
  :employer "employer:acme"
  :client "client:techcorp"
  :job-type "job:software-dev"})

(seed Placement "placement:bob-retail" {:start-date 1688515200000
  :status "active"
  :pay-rate 18
  :bill-rate 28
  :employee "emp:bob"
  :employer "employer:acme"
  :client "client:retail-giant"
  :job-type "job:warehouse"})

(seed Placement "placement:carol-techcorp" {:start-date 1696291200000
  :status "active"
  :pay-rate 22
  :bill-rate 35
  :employee "emp:carol"
  :employer "employer:premier"
  :client "client:techcorp"
  :job-type "job:admin"})

(seed Placement "placement:david-pending" {:start-date 1704067200000
  :status "pending"
  :employee "emp:david"})

(seed Placement "placement:emma-acme" {:start-date 1704240000000
  :status "active"
  :pay-rate 22
  :bill-rate 35
  :employee "emp:emma"
  :employer "employer:acme"
  :client "client:techcorp"
  :job-type "job:admin"})

;; ---------------------------------------------------------------------------
;; Policies
;; ---------------------------------------------------------------------------

(seed Policy "policy:federal-standard" {:name "Federal Standard Onboarding"
  :description "Standard federal compliance requirements for all new hires: I-9, W-4, BGC, direct deposit, and employee handbook"
  :status "active"})

(seed Policy "policy:california" {:name "California Supplement"
  :description "Additional requirements for employees working in California: state tax withholding and CA-specific notices"
  :status "active"})

;; ---------------------------------------------------------------------------
;; Onboarding Tasks - David
;; ---------------------------------------------------------------------------

(seed OnboardingTask "task:david-i9" {:onboardingtask/title "I-9 Employment Eligibility"
  :onboardingtask/document-name "I-9 Employment Eligibility"
  :onboardingtask/status "submitted"
  :onboardingtask/priority "critical"
  :onboardingtask/due-date 1704153600000
  :onboardingtask/assignee-role "employee"
  :onboardingtask/employee "emp:david"
  :onboardingtask/placement "placement:david-pending"
  :onboardingtask/policy "policy:federal-standard"})

(seed OnboardingTask "task:david-w4" {:onboardingtask/title "W-4 Federal Tax Withholding"
  :onboardingtask/document-name "W-4 Federal Tax Withholding"
  :onboardingtask/status "approved"
  :onboardingtask/priority "high"
  :onboardingtask/due-date 1704499200000
  :onboardingtask/completed-at 1703894400000
  :onboardingtask/assignee-role "employee"
  :onboardingtask/employee "emp:david"
  :onboardingtask/placement "placement:david-pending"
  :onboardingtask/policy "policy:federal-standard"})

(seed OnboardingTask "task:david-bgc" {:onboardingtask/title "Background Check"
  :onboardingtask/document-name "Background Check Consent"
  :onboardingtask/status "in-progress"
  :onboardingtask/priority "high"
  :onboardingtask/due-date 1704326400000
  :onboardingtask/assignee-role "system"
  :onboardingtask/employee "emp:david"
  :onboardingtask/placement "placement:david-pending"
  :onboardingtask/policy "policy:federal-standard"})

(seed OnboardingTask "task:david-dd" {:onboardingtask/title "Direct Deposit Setup"
  :onboardingtask/document-name "Direct Deposit Authorization"
  :onboardingtask/status "pending"
  :onboardingtask/priority "medium"
  :onboardingtask/due-date 1704931200000
  :onboardingtask/assignee-role "employee"
  :onboardingtask/employee "emp:david"
  :onboardingtask/placement "placement:david-pending"
  :onboardingtask/policy "policy:federal-standard"})

(seed OnboardingTask "task:david-handbook" {:onboardingtask/title "Employee Handbook Acknowledgment"
  :onboardingtask/document-name "Employee Handbook"
  :onboardingtask/status "approved"
  :onboardingtask/priority "medium"
  :onboardingtask/due-date 1704499200000
  :onboardingtask/completed-at 1703980800000
  :onboardingtask/assignee-role "employee"
  :onboardingtask/employee "emp:david"
  :onboardingtask/placement "placement:david-pending"
  :onboardingtask/policy "policy:federal-standard"})

;; David's I-9 Section 2 requirement record. Runtime employer work still flows
;; through the live Task system, but this ontology record tracks the required
;; onboarding step for coverage and compliance reasoning.
(seed OnboardingTask "task:david-i9-s2" {:onboardingtask/title "I-9 Section 2 (Employer Review)"
  :onboardingtask/document-name "I-9 Employment Eligibility"
  :onboardingtask/status "pending"
  :onboardingtask/priority "critical"
  :onboardingtask/due-date 1704240000000
  :onboardingtask/assignee-role "employer"
  :onboardingtask/employee "emp:david"
  :onboardingtask/placement "placement:david-pending"
  :onboardingtask/policy "policy:federal-standard"})

;; ---------------------------------------------------------------------------
;; Onboarding Tasks - Emma
;; ---------------------------------------------------------------------------
;; Emma has NO pre-existing tasks. She is a clean demo subject for the
;; compliance loop: the onboarding-missing-i9 rule fires against her because
;; she has a placement with an employer but no I-9 task.

;; ---------------------------------------------------------------------------
;; Onboarding Tasks - Alice (completed)
;; ---------------------------------------------------------------------------

(seed OnboardingTask "task:alice-i9" {:onboardingtask/title "I-9 Employment Eligibility"
  :onboardingtask/document-name "I-9 Employment Eligibility"
  :onboardingtask/status "approved"
  :onboardingtask/priority "critical"
  :onboardingtask/completed-at 1672099200000
  :onboardingtask/assignee-role "employee"
  :onboardingtask/employee "emp:alice"
  :onboardingtask/placement "placement:alice-techcorp"
  :onboardingtask/policy "policy:federal-standard"})

(seed OnboardingTask "task:alice-w4" {:onboardingtask/title "W-4 Federal Tax Withholding"
  :onboardingtask/document-name "W-4 Federal Tax Withholding"
  :onboardingtask/status "approved"
  :onboardingtask/priority "high"
  :onboardingtask/completed-at 1672099200000
  :onboardingtask/assignee-role "employee"
  :onboardingtask/employee "emp:alice"
  :onboardingtask/placement "placement:alice-techcorp"
  :onboardingtask/policy "policy:federal-standard"})

(seed OnboardingTask "task:alice-bgc" {:onboardingtask/title "Background Check"
  :onboardingtask/document-name "Background Check Consent"
  :onboardingtask/status "approved"
  :onboardingtask/priority "high"
  :onboardingtask/completed-at 1672272000000
  :onboardingtask/assignee-role "system"
  :onboardingtask/employee "emp:alice"
  :onboardingtask/placement "placement:alice-techcorp"
  :onboardingtask/policy "policy:federal-standard"})

;; ---------------------------------------------------------------------------
;; Documents
;; ---------------------------------------------------------------------------

(seed Document "doc:alice-i9" {:name "Alice Johnson - I-9"
  :type "i9"
  :status "signed"
  :created-at 1671926400000
  :signed-at 1672099200000
  :employee "emp:alice"})

(seed Document "doc:alice-w4" {:name "Alice Johnson - W-4"
  :type "w4"
  :status "signed"
  :created-at 1671926400000
  :signed-at 1672099200000
  :employee "emp:alice"})

(seed Document "doc:alice-bgc" {:name "Alice Johnson - BGC Consent"
  :type "bgc-consent"
  :status "signed"
  :created-at 1671926400000
  :signed-at 1672272000000
  :employee "emp:alice"})

(seed Document "doc:david-i9" {:name "David Chen - I-9"
  :type "i9"
  :status "generated"
  :created-at 1704067200000
  :employee "emp:david"})

(seed Document "doc:david-w4" {:name "David Chen - W-4"
  :type "w4"
  :status "signed"
  :created-at 1704067200000
  :signed-at 1703894400000
  :employee "emp:david"})

(seed Document "doc:david-handbook" {:name "David Chen - Employee Handbook"
  :type "handbook-ack"
  :status "signed"
  :created-at 1704067200000
  :signed-at 1703980800000
  :employee "emp:david"})

;; ---------------------------------------------------------------------------
;; Link Instances
;; ---------------------------------------------------------------------------

;; Employment relationships
(link works-at "emp:alice" "employer:acme" {:start-date 1672531200000
  :status "active"})

(link works-at "emp:bob" "employer:acme" {:start-date 1688515200000
  :status "active"})

(link works-at "emp:carol" "employer:premier" {:start-date 1696291200000
  :status "active"})

(link works-at "emp:emma" "employer:acme" {:start-date 1704240000000
  :status "active"})

(link works-at "emp:frank" "employer:acme" {:start-date 1660348800000
  :end-date 1701475200000
  :status "inactive"})

;; Placements at clients
(link placed-at "emp:alice" "client:techcorp" {:start-date 1672531200000
  :employer "employer:acme"
  :jobtype "job:software-dev"
  :status "active"})

(link placed-at "emp:bob" "client:retail-giant" {:start-date 1688515200000
  :employer "employer:acme"
  :jobtype "job:warehouse"
  :status "active"})

(link placed-at "emp:carol" "client:techcorp" {:start-date 1696291200000
  :employer "employer:premier"
  :jobtype "job:admin"
  :status "active"})

(link placed-at "emp:emma" "client:techcorp" {:start-date 1704240000000
  :employer "employer:acme"
  :jobtype "job:admin"
  :status "active"})

;; Employer-Client relationships
(link serves-client "employer:acme" "client:techcorp" {:since 1609459200000
  :contract-type "preferred"})

(link serves-client "employer:acme" "client:retail-giant" {:since 1672531200000
  :contract-type "approved"})

(link serves-client "employer:premier" "client:techcorp" {:since 1688515200000
  :contract-type "approved"})

;; Policy governance
(link governed-by "employer:acme" "policy:federal-standard" {:since 1609459200000
  :overridden false})

(link governed-by "employer:premier" "policy:federal-standard" {:since 1688515200000
  :overridden false})

;; Task assignments
(link assigned-task "emp:david" "task:david-i9" {:assigned-at 1704067200000})

(link assigned-task "emp:david" "task:david-w4" {:assigned-at 1704067200000})

(link assigned-task "emp:david" "task:david-bgc" {:assigned-at 1704067200000})

(link assigned-task "emp:david" "task:david-dd" {:assigned-at 1704067200000})

(link assigned-task "emp:david" "task:david-handbook" {:assigned-at 1704067200000})

(link assigned-task "emp:david" "task:david-i9-s2" {:assigned-at 1704153600000})

;; Emma has no pre-existing tasks (clean demo subject for compliance loop)

(link assigned-task "emp:alice" "task:alice-i9" {:assigned-at 1671926400000})

(link assigned-task "emp:alice" "task:alice-w4" {:assigned-at 1671926400000})

(link assigned-task "emp:alice" "task:alice-bgc" {:assigned-at 1671926400000})

;; Documents
(link has-document "emp:alice" "doc:alice-i9" {:uploaded-at 1672099200000})

(link has-document "emp:alice" "doc:alice-w4" {:uploaded-at 1672099200000})

(link has-document "emp:alice" "doc:alice-bgc" {:uploaded-at 1672272000000})

(link has-document "emp:david" "doc:david-i9" {:uploaded-at 1704067200000})

(link has-document "emp:david" "doc:david-w4" {:uploaded-at 1703894400000})

(link has-document "emp:david" "doc:david-handbook" {:uploaded-at 1703980800000})
```

```

```
