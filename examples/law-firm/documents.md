# Documents

```lisp
(export client-intake-form engagement-letter)

;; =============================================================================
;; Client Intake Form
;; =============================================================================
;;
;; A multi-party intake form. The client contact provides background,
;; counterparties, and goals. The firm completes risk, conflict, and engagement
;; routing fields before a matter is opened.
;;

(document client-intake-form :description "Collect prospective client background, adverse parties, deadlines, and routing information"
 (page client-background :assignee client-contact :description "Client Background" :completion (completion submit-intake-packet :entity Client)
 (content :intake.background_intro "# Client Intake\n\nPlease provide the information the firm needs to evaluate representation, run conflicts, and prepare an engagement letter.\n\n---")
 (text :intake.client_name "Client Legal Name" :required true :bind Client.name)
 (select :intake.client_type "Client Type" :required true :bind Client.type
 (option "business" "Business")
 (option "individual" "Individual")
 (option "nonprofit" "Nonprofit")
 (option "government" "Government"))
 (text :intake.industry "Industry or Context"  :bind Client.industry)
 (text :intake.primary_contact_name "Primary Contact Name" :required true)
 (text :intake.primary_contact_title "Primary Contact Title")
 (text :intake.primary_contact_email "Primary Contact Email" :required true :bind Client.email)
 (text :intake.primary_contact_phone "Primary Contact Phone"  :bind Client.phone)
 (content :intake.matter_intro "---\n\n## Legal Need\n\nDescribe the legal work requested and any deadlines or counterparties the firm should know about.")
 (select :intake.practice_area "Likely Practice Area" :required true
 (option "corporate" "Corporate")
 (option "employment" "Employment")
 (option "litigation" "Litigation")
 (option "real-estate" "Real Estate")
 (option "estate-planning" "Estate Planning")
 (option "other" "Other"))
 (textarea :intake.matter_summary "Matter Summary" :required true)
 (textarea :intake.adverse_parties "Known Adverse Parties or Related Parties" :required true)
 (date :intake.next_deadline "Next Known Deadline")
 (textarea :intake.documents_available "Documents Already Available"))
 (page firm-review :assignee firm-staff :description "Firm Review" :depends-on [client-background] :completion (completion complete-firm-review :entity Client)
 (content :intake.review_intro "# Firm Review\n\nComplete internal routing before representation begins.\n\n---")
 (select :intake.conflict_status "Conflict Check Status" :required true
 (option "pending" "Pending")
 (option "cleared" "Cleared")
 (option "needs-review" "Needs Attorney Review")
 (option "blocked" "Blocked"))
 (select :intake.risk_level "Client Risk Level" :required true :bind Client.risk-level
 (option "low" "Low")
 (option "medium" "Medium")
 (option "high" "High"))
 (select :intake.fee_arrangement "Fee Arrangement" :required true
 (option "hourly" "Hourly")
 (option "flat-fee" "Flat Fee")
 (option "retainer" "Monthly Retainer")
 (option "contingency" "Contingency"))
 (number :intake.initial_budget "Initial Budget")
 (textarea :intake.scope_notes "Scope Notes" :required true)
 (checkbox :intake.approved_for_engagement "Approved for Engagement Letter" :required true)))
```

```lisp
;; =============================================================================
;; Engagement Letter
;; =============================================================================
;;
;; A lightweight engagement letter artifact that captures scope, fee structure,
;; conflict acknowledgement, and client acceptance.
;;

(document engagement-letter :description "Confirm scope, fees, responsibilities, and client acceptance for a matter"
 (page client-acceptance :assignee client-contact :description "Client Acceptance" :completion (completion complete-engagement-letter :entity EngagementLetter)
 (content :engagement.intro "# Engagement Letter\n\nReview the proposed scope, fee terms, and responsibilities. Signing confirms that the client authorizes the firm to begin work on the matter.\n\n---")
 (text :engagement.client_name "Client Name" :required true)
 (text :engagement.matter_title "Matter Title" :required true)
 (textarea :engagement.scope_summary "Scope of Work" :required true :bind EngagementLetter.scope-summary)
 (select :engagement.fee_type "Fee Type" :required true :bind EngagementLetter.fee-type
 (option "hourly" "Hourly")
 (option "flat-fee" "Flat Fee")
 (option "retainer" "Monthly Retainer")
 (option "contingency" "Contingency"))
 (number :engagement.budget "Estimated Budget")
 (checkbox :engagement.conflict_acknowledgement "I acknowledge that representation begins only after conflict clearance and firm acceptance" :required true)
 (checkbox :engagement.client_signature "Client Signature" :required true)))
```

```lisp
;; =============================================================================
;; Law Firm Documents - English Locale
;; =============================================================================

(document-locale client-intake-form "en"
 (role client-contact :label "Client Contact" :description "The client representative completing intake")
 (role firm-staff :label "Firm Staff" :description "The intake coordinator or attorney reviewing the packet")
 (section client-background :label "Client Background")
 (section firm-review :label "Firm Review")
 (field :intake.client_name :label "Client Legal Name")
 (field :intake.client_type :label "Client Type")
 (field :intake.industry :label "Industry or Context")
 (field :intake.primary_contact_name :label "Primary Contact Name")
 (field :intake.primary_contact_title :label "Primary Contact Title")
 (field :intake.primary_contact_email :label "Primary Contact Email")
 (field :intake.primary_contact_phone :label "Primary Contact Phone")
 (field :intake.practice_area :label "Likely Practice Area")
 (field :intake.matter_summary :label "Matter Summary")
 (field :intake.adverse_parties :label "Known Adverse Parties or Related Parties")
 (field :intake.next_deadline :label "Next Known Deadline")
 (field :intake.documents_available :label "Documents Already Available")
 (field :intake.conflict_status :label "Conflict Check Status")
 (field :intake.risk_level :label "Client Risk Level")
 (field :intake.fee_arrangement :label "Fee Arrangement")
 (field :intake.initial_budget :label "Initial Budget")
 (field :intake.scope_notes :label "Scope Notes")
 (field :intake.approved_for_engagement :label "Approved for Engagement Letter"))

(document-locale engagement-letter "en"
 (role client-contact :label "Client Contact" :description "The person authorized to accept the engagement")
 (section client-acceptance :label "Client Acceptance")
 (field :engagement.client_name :label "Client Name")
 (field :engagement.matter_title :label "Matter Title")
 (field :engagement.scope_summary :label "Scope of Work")
 (field :engagement.fee_type :label "Fee Type")
 (field :engagement.budget :label "Estimated Budget")
 (field :engagement.conflict_acknowledgement :label "Conflict Acknowledgement")
 (field :engagement.client_signature :label "Client Signature"))
```
