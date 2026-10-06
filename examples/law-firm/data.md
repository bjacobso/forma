# Seed Data

```lisp
(export
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
  invoice-for)

;; =============================================================================
;; Law Firm Backoffice Ontology - Seed Data
;; =============================================================================
;;
;; Demo narrative: Hale & Rivera LLP manages a mixed client portfolio. The firm
;; is onboarding a startup, clearing an employment matter, responding to a
;; litigation deadline, and chasing estate-planning documents.
;;
;; ---------------------------------------------------------------------------
;; Firm Staff
;; ---------------------------------------------------------------------------
(seed Attorney "atty:amelia"
  {
    :first-name "Amelia"
    :last-name "Hale"
    :email "ahale@halerivera.law"
    :phone "+1-312-555-0101"
    :bar-number "IL-448291"
    :practice-area "corporate"
    :status "active"})
(seed Attorney "atty:marco"
  {
    :first-name "Marco"
    :last-name "Rivera"
    :email "mrivera@halerivera.law"
    :phone "+1-312-555-0102"
    :bar-number "IL-451037"
    :practice-area "litigation"
    :status "active"})
(seed Paralegal "para:nora"
  {
    :first-name "Nora"
    :last-name "Kim"
    :email "nkim@halerivera.law"
    :team "intake"
    :status "active"})
(seed Paralegal "para:eli"
  {
    :first-name "Eli"
    :last-name "Brooks"
    :email "ebrooks@halerivera.law"
    :team "matters"
    :status "active"})

;; ---------------------------------------------------------------------------
;; Clients
;; ---------------------------------------------------------------------------
(seed Client "client:northstar"
  {
    :name "Northstar Robotics"
    :type "business"
    :industry "Technology"
    :phone "+1-312-555-1100"
    :email "legal@northstarrobotics.com"
    :status "onboarding"
    :risk-level "medium"
    :source "founder-referral"})
(seed Client "client:brightpath"
  {
    :name "BrightPath Education"
    :type "nonprofit"
    :industry "Education"
    :phone "+1-312-555-1200"
    :email "ops@brightpath.org"
    :status "active"
    :risk-level "low"
    :source "existing-client"})
(seed Client "client:lakeside"
  {
    :name "Lakeside Foods"
    :type "business"
    :industry "Food Distribution"
    :phone "+1-312-555-1300"
    :email "gc@lakesidefoods.com"
    :status "active"
    :risk-level "high"
    :source "urgent-litigation"})
(seed Client "client:carter"
  {
    :name "Dana Carter"
    :type "individual"
    :industry "Estate Planning"
    :phone "+1-312-555-1400"
    :email "dana.carter@example.com"
    :status "active"
    :risk-level "medium"
    :source "website"})

;; ---------------------------------------------------------------------------
;; Contacts
;; ---------------------------------------------------------------------------
(seed Contact "contact:maya"
  {
    :name "Maya Singh"
    :title "Founder"
    :email "maya@northstarrobotics.com"
    :phone "+1-312-555-1101"
    :role "decision-maker"})
(seed Contact "contact:owen"
  {
    :name "Owen Brooks"
    :title "Operations Director"
    :email "owen@brightpath.org"
    :phone "+1-312-555-1201"
    :role "operations"})
(seed Contact "contact:sofia"
  {
    :name "Sofia Morales"
    :title "General Counsel"
    :email "sofia@lakesidefoods.com"
    :phone "+1-312-555-1301"
    :role "legal"})
(seed Contact "contact:dana"
  {
    :name "Dana Carter"
    :title "Client"
    :email "dana.carter@example.com"
    :phone "+1-312-555-1400"
    :role "client"})

;; ---------------------------------------------------------------------------
;; Intake and Conflicts
;; ---------------------------------------------------------------------------
(seed IntakePacket "intake:northstar"
  {
    :intakepacket/status "submitted"
    :intakepacket/submitted-at 1711929600000
    :intakepacket/notes
      "Founder requests formation cleanup, commercial contract templates, and first financing readiness."})
(seed IntakePacket "intake:carter"
  {
    :intakepacket/status "reviewed"
    :intakepacket/submitted-at 1709251200000
    :intakepacket/reviewed-at 1709337600000
    :intakepacket/notes
      "Estate plan intake complete. Waiting on financial account list."})
(seed ConflictCheck "conflict:northstar"
  {
    :conflictcheck/status "pending"
    :conflictcheck/search-terms
      "Northstar Robotics; Maya Singh; Apex Components"
    :conflictcheck/result "not-run"
    :conflictcheck/notes "Counterparty list supplied by founder. Search queued."})
(seed ConflictCheck "conflict:lakeside"
  {
    :conflictcheck/status "needs-review"
    :conflictcheck/search-terms
      "Lakeside Foods; Beacon Packaging; Sofia Morales"
    :conflictcheck/result "possible-prior-consult"
    :conflictcheck/reviewed-by "Nora Kim"
    :conflictcheck/reviewed-at 1710115200000
    :conflictcheck/notes
      "Beacon Packaging appeared in a prior declined consultation. Attorney review required."})
(seed ConflictCheck "conflict:brightpath"
  {
    :conflictcheck/status "cleared"
    :conflictcheck/search-terms "BrightPath Education; Owen Brooks"
    :conflictcheck/result "clear"
    :conflictcheck/reviewed-by "Nora Kim"
    :conflictcheck/reviewed-at 1706745600000})
(seed ConflictCheck "conflict:carter"
  {
    :conflictcheck/status "cleared"
    :conflictcheck/search-terms "Dana Carter; Riley Carter"
    :conflictcheck/result "clear"
    :conflictcheck/reviewed-by "Nora Kim"
    :conflictcheck/reviewed-at 1709337600000})

;; ---------------------------------------------------------------------------
;; Matters
;; ---------------------------------------------------------------------------
(seed Matter "matter:northstar-general"
  {
    :title "Northstar General Counsel Setup"
    :practice-area "corporate"
    :status "opening"
    :opened-date 1712016000000
    :next-deadline 1712620800000
    :budget 8500
    :fee-type "retainer"
    :summary
      "Set up outside general counsel workflow, contract templates, and financing readiness checklist."})
(seed Matter "matter:brightpath-handbook"
  {
    :title "BrightPath Handbook Refresh"
    :practice-area "employment"
    :status "active"
    :opened-date 1706745600000
    :next-deadline 1712880000000
    :budget 6000
    :fee-type "flat-fee"
    :summary
      "Update employee handbook, leave policies, and contractor classification guidance."})
(seed Matter "matter:lakeside-litigation"
  {
    :title "Lakeside Supplier Dispute"
    :practice-area "litigation"
    :status "active"
    :opened-date 1710115200000
    :next-deadline 1710806400000
    :budget 25000
    :fee-type "hourly"
    :summary
      "Respond to supplier demand letter and preserve documents for threatened commercial litigation."})
(seed Matter "matter:carter-estate"
  {
    :title "Dana Carter Estate Plan"
    :practice-area "estate-planning"
    :status "active"
    :opened-date 1709510400000
    :next-deadline 1713484800000
    :budget 4200
    :fee-type "flat-fee"
    :summary
      "Prepare will, trust, healthcare directive, and durable power of attorney."})

;; ---------------------------------------------------------------------------
;; Engagement Letters
;; ---------------------------------------------------------------------------
(seed EngagementLetter "letter:northstar"
  {
    :engagementletter/status "sent"
    :engagementletter/sent-at 1712016000000
    :engagementletter/fee-type "retainer"
    :engagementletter/scope-summary
      "Outside general counsel setup and corporate housekeeping."})
(seed EngagementLetter "letter:brightpath"
  {
    :engagementletter/status "signed"
    :engagementletter/sent-at 1706745600000
    :engagementletter/signed-at 1706832000000
    :engagementletter/fee-type "flat-fee"
    :engagementletter/scope-summary "Employment handbook refresh."})
(seed EngagementLetter "letter:lakeside"
  {
    :engagementletter/status "signed"
    :engagementletter/sent-at 1710115200000
    :engagementletter/signed-at 1710201600000
    :engagementletter/fee-type "hourly"
    :engagementletter/scope-summary
      "Commercial dispute response and document preservation."})
(seed EngagementLetter "letter:carter"
  {
    :engagementletter/status "signed"
    :engagementletter/sent-at 1709510400000
    :engagementletter/signed-at 1709596800000
    :engagementletter/fee-type "flat-fee"
    :engagementletter/scope-summary "Estate planning package."})

;; ---------------------------------------------------------------------------
;; Case Tasks
;; ---------------------------------------------------------------------------
(seed CaseTask "task:northstar-conflicts"
  {
    :casetask/title "Finish Northstar conflict search"
    :casetask/type "conflicts"
    :casetask/priority "high"
    :casetask/status "pending"
    :casetask/due-date 1712102400000
    :casetask/assignee-role "intake-coordinator"
    :casetask/notes
      "Search founder, company, investor, and first three counterparties."})
(seed CaseTask "task:northstar-letter"
  {
    :casetask/title "Follow up on Northstar engagement letter"
    :casetask/type "engagement-letter"
    :casetask/priority "high"
    :casetask/status "in-progress"
    :casetask/due-date 1712361600000
    :casetask/assignee-role "intake-coordinator"
    :casetask/notes "Founder asked for one scope clarification before signing."})
(seed CaseTask "task:brightpath-policy"
  {
    :casetask/title "Attorney review of handbook redline"
    :casetask/type "legal-review"
    :casetask/priority "medium"
    :casetask/status "pending"
    :casetask/due-date 1712620800000
    :casetask/assignee-role "attorney"
    :casetask/notes "Review leave policy changes before client call."})
(seed CaseTask "task:lakeside-preservation"
  {
    :casetask/title "Issue litigation hold instructions"
    :casetask/type "deadline"
    :casetask/priority "urgent"
    :casetask/status "in-progress"
    :casetask/due-date 1710374400000
    :casetask/assignee-role "attorney"
    :casetask/notes
      "Demand letter alleges spoliation risk. Send hold instructions today."})
(seed CaseTask "task:lakeside-demand"
  {
    :casetask/title "Draft demand-letter response"
    :casetask/type "drafting"
    :casetask/priority "urgent"
    :casetask/status "pending"
    :casetask/due-date 1710806400000
    :casetask/assignee-role "attorney"
    :casetask/notes "Response deadline is one week from receipt."})
(seed CaseTask "task:carter-draft"
  {
    :casetask/title "Prepare Carter estate plan drafts"
    :casetask/type "drafting"
    :casetask/priority "medium"
    :casetask/status "pending"
    :casetask/due-date 1713225600000
    :casetask/assignee-role "paralegal"
    :casetask/notes
      "Draft after account list and beneficiary updates are received."})

;; ---------------------------------------------------------------------------
;; Document Requests
;; ---------------------------------------------------------------------------
(seed DocumentRequest "docreq:northstar-cap-table"
  {
    :documentrequest/title "Current cap table and option plan"
    :documentrequest/status "requested"
    :documentrequest/due-date 1712361600000
    :documentrequest/requested-from "Maya Singh"
    :documentrequest/notes "Needed before financing-readiness review."})
(seed DocumentRequest "docreq:brightpath-handbook"
  {
    :documentrequest/title "Current employee handbook"
    :documentrequest/status "received"
    :documentrequest/due-date 1707350400000
    :documentrequest/received-at 1707264000000
    :documentrequest/requested-from "Owen Brooks"
    :documentrequest/notes "Uploaded PDF and editable source."})
(seed DocumentRequest "docreq:lakeside-contracts"
  {
    :documentrequest/title "Supplier agreement and correspondence"
    :documentrequest/status "overdue"
    :documentrequest/due-date 1710288000000
    :documentrequest/requested-from "Sofia Morales"
    :documentrequest/notes "Needed for demand-letter response and hold scope."})
(seed DocumentRequest "docreq:carter-accounts"
  {
    :documentrequest/title "Financial account list"
    :documentrequest/status "overdue"
    :documentrequest/due-date 1710979200000
    :documentrequest/requested-from "Dana Carter"
    :documentrequest/notes "Needed before trust funding memo."})

;; ---------------------------------------------------------------------------
;; Invoices
;; ---------------------------------------------------------------------------
(seed Invoice "invoice:brightpath-001"
  {
    :number "BP-2024-001"
    :status "draft"
    :amount 3000
    :issued-at 1712016000000
    :due-date 1714608000000
    :needs-review true})
(seed Invoice "invoice:lakeside-001"
  {
    :number "LF-2024-001"
    :status "draft"
    :amount 7200
    :issued-at 1712016000000
    :due-date 1714608000000
    :needs-review true})
(seed Invoice "invoice:carter-001"
  {
    :number "DC-2024-001"
    :status "sent"
    :amount 2100
    :issued-at 1709596800000
    :due-date 1712188800000
    :needs-review false})

;; ---------------------------------------------------------------------------
;; Link Instances
;; ---------------------------------------------------------------------------
;; Attorney-client representation
(link represents "atty:amelia" "client:northstar"
  {:since 1711929600000 :role "prospective-lead"})
(link represents "atty:amelia" "client:brightpath"
  {:since 1706745600000 :role "lead"})
(link represents "atty:marco" "client:lakeside"
  {:since 1710115200000 :role "lead"})
(link represents "atty:amelia" "client:carter"
  {:since 1709510400000 :role "lead"})

;; Contacts at clients
(link contact-at "contact:maya" "client:northstar" {:primary true})
(link contact-at "contact:owen" "client:brightpath" {:primary true})
(link contact-at "contact:sofia" "client:lakeside" {:primary true})
(link contact-at "contact:dana" "client:carter" {:primary true})

;; Intake and conflicts
(link intake-for "intake:northstar" "client:northstar" {})
(link intake-for "intake:carter" "client:carter" {})
(link conflict-for "conflict:northstar" "client:northstar" {})
(link conflict-for "conflict:lakeside" "client:lakeside" {})
(link conflict-for "conflict:brightpath" "client:brightpath" {})
(link conflict-for "conflict:carter" "client:carter" {})

;; Matters to clients
(link matter-for "matter:northstar-general" "client:northstar" {})
(link matter-for "matter:brightpath-handbook" "client:brightpath" {})
(link matter-for "matter:lakeside-litigation" "client:lakeside" {})
(link matter-for "matter:carter-estate" "client:carter" {})

;; Matter staffing
(link matter-managed-by "matter:northstar-general" "atty:amelia" {})
(link matter-managed-by "matter:brightpath-handbook" "atty:amelia" {})
(link matter-managed-by "matter:lakeside-litigation" "atty:marco" {})
(link matter-managed-by "matter:carter-estate" "atty:amelia" {})
(link matter-supported-by "matter:northstar-general" "para:nora" {})
(link matter-supported-by "matter:brightpath-handbook" "para:eli" {})
(link matter-supported-by "matter:lakeside-litigation" "para:eli" {})
(link matter-supported-by "matter:carter-estate" "para:nora" {})

;; Engagement letters
(link engagement-letter-for "letter:northstar" "matter:northstar-general" {})
(link engagement-letter-for "letter:brightpath" "matter:brightpath-handbook" {})
(link engagement-letter-for "letter:lakeside" "matter:lakeside-litigation" {})
(link engagement-letter-for "letter:carter" "matter:carter-estate" {})

;; Tasks
(link task-for-matter "task:northstar-conflicts" "matter:northstar-general" {})
(link task-for-matter "task:northstar-letter" "matter:northstar-general" {})
(link task-for-matter "task:brightpath-policy" "matter:brightpath-handbook" {})
(link task-for-matter "task:lakeside-preservation" "matter:lakeside-litigation"
  {})
(link task-for-matter "task:lakeside-demand" "matter:lakeside-litigation" {})
(link task-for-matter "task:carter-draft" "matter:carter-estate" {})

;; Document requests
(link document-request-for "docreq:northstar-cap-table"
  "matter:northstar-general"
  {})
(link document-request-for "docreq:brightpath-handbook"
  "matter:brightpath-handbook"
  {})
(link document-request-for "docreq:lakeside-contracts"
  "matter:lakeside-litigation"
  {})
(link document-request-for "docreq:carter-accounts" "matter:carter-estate" {})

;; Invoices
(link invoice-for "invoice:brightpath-001" "matter:brightpath-handbook" {})
(link invoice-for "invoice:lakeside-001" "matter:lakeside-litigation" {})
(link invoice-for "invoice:carter-001" "matter:carter-estate" {})
```
