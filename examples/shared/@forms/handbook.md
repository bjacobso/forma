---
title: Employee Handbook Acknowledgement
---

# Employee Handbook Acknowledgement

The Employee Handbook contains essential information about company policies, benefits, safety procedures, and employment terms. All new hires must acknowledge receipt and review of the handbook as part of the onboarding process.

This acknowledgement confirms that the employee has received, read, and understood the handbook, and agrees to comply with all policies contained within it.

## Acknowledgements

```lisp
(define-document "Employee Handbook Acknowledgement"
  (description "Confirm you have received and reviewed the employee handbook")

  (form-page (section-id "handbook-acknowledgement")
    (assignee employee)
    (page-description "Handbook Acknowledgement")

    (form-field
      :content :handbook.intro
      (content
        "# Employee Handbook Acknowledgement\n\nWelcome to the team! As part of your onboarding process, please review and acknowledge receipt of the Employee Handbook.\n\nThe Employee Handbook contains important information about:\n\n- **Company Policies** - Workplace conduct, dress code, attendance\n- **Benefits** - Health insurance, PTO, retirement plans\n- **Safety Procedures** - Emergency protocols, reporting incidents\n- **Employment Terms** - At-will employment, termination procedures\n\nPlease read the handbook carefully before completing this acknowledgement.\n\n---\n\n## Acknowledgements\n\nPlease check each box to confirm your understanding:"))

    (form-field
      :boolean :handbook.received
      (label "I have received the employee handbook")
      (form-required true))
    (form-field
      :boolean :handbook.read
      (label "I have read the employee handbook")
      (form-required true))
    (form-field
      :boolean :handbook.agree_to_comply
      (label "I agree to comply with handbook policies")
      (form-required true))

    (form-field
      :content :handbook.at_will_notice
      (content
        "---\n\n## Important Notice\n\n> **At-Will Employment:** Your employment with the company is at-will. This means that either you or the company may terminate the employment relationship at any time, with or without cause, and with or without notice.\n>\n> The Employee Handbook is not an employment contract and does not guarantee employment for any specific period of time."))

    (form-field
      :boolean :handbook.understand_at_will
      (label "I understand the at-will employment notice")
      (form-required true))
    (form-field
      :boolean :handbook.understand_changes
      (label "I understand the handbook may be updated")
      (form-required true))

    (form-field
      :content :handbook.questions_section
      (content
        "---\n\n## Questions?\n\nIf you have any questions about the handbook or company policies, please note them below or contact Human Resources directly."))

    (form-field :text :handbook.questions (label "Questions"))

    (form-field
      :content :handbook.signature_section
      (content
        "---\n\n## Signature\n\nBy signing below, you confirm all of the acknowledgements above."))

    (form-field
      :boolean :handbook.signature
      (label "Employee Signature")
      (form-required true))))
```

## Locale: English

```lisp
(define-document-locale "Employee Handbook Acknowledgement"
  en
  (section "handbook-acknowledgement" (label "Handbook Acknowledgement"))
  (field ":handbook.received" (label "I have received the employee handbook"))
  (field ":handbook.read" (label "I have read the employee handbook"))
  (field ":handbook.agree_to_comply"
    (label "I agree to comply with handbook policies"))
  (field ":handbook.understand_at_will"
    (label "I understand the at-will employment notice"))
  (field ":handbook.understand_changes"
    (label "I understand the handbook may be updated"))
  (field ":handbook.questions" (label "Questions"))
  (field ":handbook.signature" (label "Employee Signature")))

(define-document-localized "Employee Handbook Acknowledgement"
  (locales en)
  (default-locale en))
```
