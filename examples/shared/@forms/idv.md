---
title: Identity Document Verification
---

# Identity Document Verification

Identity verification ensures that the individual presenting documents is who they claim to be. This multi-step process involves document upload by the employee, automated verification (when available), and final review by HR.

## Document Upload

The employee uploads primary identification (passport, driver's license, etc.) and optionally a secondary document for additional verification.

```lisp
(define-document "Identity Document Verification"
  (description "Upload and verify identity documents with HR review")

  ;; Section 1: Document Upload (employee)
  (form-page
    (section-id "document-upload")
    (assignee employee)
    (page-description "Document Upload")

    (form-field :select :idv.primary_doc_type
      (label "Primary Document Type")
      (form-required true)
      (options
        (option "passport" "Passport")
        (option "drivers_license" "Driver's License")
        (option "state_id" "State ID")
        (option "national_id" "National ID")))
    (form-field :text :idv.primary_doc_file
      (label "Primary Document Upload")
      (form-required true))
    (form-field :select :idv.secondary_doc_type
      (label "Secondary Document Type")
      (options
        (option "utility_bill" "Utility Bill")
        (option "bank_statement" "Bank Statement")
        (option "tax_document" "Tax Document")))
    (form-field :text :idv.secondary_doc_file
      (label "Secondary Document Upload")))
```

## Automated Verification

The system performs automated document verification, producing a confidence score and detailed results.

```lisp
;; Section 2: Verification Results (system)
(form-page (section-id "verification-results")
  (assignee system)
  (depends-on "document-upload")
  (page-description "Verification Results")

  (form-field :text :idv.verification_status (label "Verification Status"))
  (form-field :text :idv.confidence_score (label "Confidence Score"))
  (form-field :text :idv.verification_details (label "Verification Details")))
```

## HR Review

An HR administrator reviews the verification results and makes a final determination. If additional documents are needed, the process loops back to the employee.

```lisp
  ;; Section 3: HR Review
  (form-page
    (section-id "hr-review")
    (assignee hr-admin)
    (depends-on "verification-results")
    (page-description "HR Review")

    (form-field :select :idv.review_decision
      (label "Review Decision")
      (form-required true)
      (options
        (option "approved" "Approved")
        (option "rejected" "Rejected")
        (option "additional_docs_required" "Additional Documents Required")))
    (form-field :text :idv.review_notes
      (label "Review Notes"))))
```

## Locale: English

```lisp
(define-document-locale "Identity Document Verification"
  en
  (role "employee" (label "Employee"))
  (role "system" (label "System"))
  (role "hr-admin" (label "HR Administrator"))
  (section "document-upload" (label "Document Upload"))
  (section "verification-results" (label "Verification Results"))
  (section "hr-review" (label "HR Review"))
  (field ":idv.primary_doc_type"
    (label "Primary Document Type")
    (options (option "passport" "Passport")
      (option "drivers_license" "Driver's License")
      (option "state_id" "State ID")
      (option "national_id" "National ID")))
  (field ":idv.primary_doc_file" (label "Primary Document Upload"))
  (field ":idv.secondary_doc_type"
    (label "Secondary Document Type")
    (options (option "utility_bill" "Utility Bill")
      (option "bank_statement" "Bank Statement")
      (option "tax_document" "Tax Document")))
  (field ":idv.secondary_doc_file" (label "Secondary Document Upload"))
  (field ":idv.verification_status" (label "Verification Status"))
  (field ":idv.confidence_score" (label "Confidence Score"))
  (field ":idv.verification_details" (label "Verification Details"))
  (field ":idv.review_decision"
    (label "Review Decision")
    (options (option "approved" "Approved")
      (option "rejected" "Rejected")
      (option "additional_docs_required" "Additional Documents Required")))
  (field ":idv.review_notes" (label "Review Notes")))

(define-document-localized "Identity Document Verification"
  (locales en)
  (default-locale en))
```
