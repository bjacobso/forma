---
title: Background Check Consent
---

# Background Check Consent

A background check is a standard part of the hiring process. Under the Fair Credit Reporting Act (FCRA), employers must obtain written consent from the applicant before conducting a background investigation.

The background check may include verification of employment history, education, criminal records, credit history, and professional references.

## Consent and Authorization

```lisp
(define-document "Background Check Consent"
  (description "Employee authorization for background check verification")

  (form-page (section-id "consent-and-authorization")
    (assignee employee)
    (page-description "Consent and Authorization")

    (form-field
      :text :bgc.full_name
      (label "Full Legal Name")
      (form-required true))
    (form-field :text :bgc.email (label "Email Address") (form-required true))
    (form-field
      :boolean :bgc.consent_acknowledgment
      (label "I consent to a background check being performed")
      (form-required true))
    (form-field
      :boolean :bgc.fcra_acknowledgment
      (label "I acknowledge my rights under the FCRA")
      (form-required true))
    (form-field
      :boolean :bgc.signature
      (label "Signature")
      (form-required true))))
```

## Locale: English

```lisp
(define-document-locale "Background Check Consent"
  en
  (section "consent-and-authorization" (label "Consent and Authorization"))
  (field ":bgc.full_name" (label "Full Legal Name"))
  (field ":bgc.email" (label "Email Address"))
  (field ":bgc.consent_acknowledgment"
    (label "I consent to a background check being performed"))
  (field ":bgc.fcra_acknowledgment"
    (label
      "I acknowledge my rights under the Fair Credit Reporting Act (FCRA)"))
  (field ":bgc.signature" (label "Signature")))

(define-document-localized "Background Check Consent"
  (locales en)
  (default-locale en))
```
