---
title: Direct Deposit Authorization
---

# Direct Deposit Authorization

Direct deposit is the electronic transfer of payroll funds directly into an employee's bank account. It eliminates the need for paper checks and ensures timely payment. This form authorizes the employer to initiate ACH transfers to the employee's designated bank account.

The authorization remains in effect until the employee provides written notice of cancellation or submits a new direct deposit form.

## Employee Bank Information

The employee provides their bank account details. A prenote (zero-dollar test transaction) is typically sent to verify the account before the first live deposit.

```lisp
(define-document "Direct Deposit Authorization"
  (description "Authorize direct deposit of payroll funds to employee bank account")

  ;; Section 1: Bank Information (employee)
  (form-page
    (section-id "bank-information")
    (assignee employee)
    (page-description "Bank Information")

    (form-field :content :dd.intro
      (content "# Direct Deposit Authorization\n\nPlease provide your bank account information below to set up direct deposit for your payroll. Your information is encrypted and stored securely.\n\n---"))

    (form-field :text :dd.bank_name
      (label "Bank Name")
      (form-required true))
    (form-field :text :dd.routing_number
      (label "Routing Number")
      (form-required true))
    (form-field :text :dd.account_number
      (label "Account Number")
      (form-required true))
    (form-field :select :dd.account_type
      (label "Account Type")
      (form-required true)
      (options
        (option "checking" "Checking")
        (option "savings" "Savings")))

    (form-field :content :dd.authorization_notice
      (content "---\n\n## Authorization\n\nBy signing below, I authorize my employer to deposit my pay directly into the bank account specified above. I understand that this authorization will remain in effect until I provide written notice of cancellation."))

    (form-field :boolean :dd.employee_signature
      (label "Employee Signature")
      (form-required true)))
```

## Employer Verification

The payroll department verifies the bank information and confirms the prenote status before initiating live deposits.

```lisp
  ;; Section 2: Employer Verification
  (form-page
    (section-id "employer-verification")
    (assignee employer)
    (depends-on "bank-information")
    (page-description "Employer Verification")

    (form-field :content :dd.verification_intro
      (content "# Employer Verification\n\nVerify the employee's bank information and confirm prenote status.\n\n---"))

    (form-field :text :dd.verified_by
      (label "Verified By")
      (form-required true))
    (form-field :date :dd.verification_date
      (label "Verification Date")
      (form-required true))
    (form-field :select :dd.prenote_status
      (label "Prenote Status")
      (form-required true)
      (options
        (option "pending" "Pending")
        (option "verified" "Verified")
        (option "failed" "Failed")))
    (form-field :text :dd.notes
      (label "Notes"))))
```

## Locale: English

```lisp
(define-document-locale "Direct Deposit Authorization"
  en
  (role "employee" (label "Employee"))
  (role "employer" (label "Payroll Department"))
  (section "bank-information" (label "Bank Information"))
  (section "employer-verification" (label "Employer Verification"))
  (field ":dd.bank_name" (label "Bank Name"))
  (field ":dd.routing_number" (label "Routing Number (9 digits)"))
  (field ":dd.account_number" (label "Account Number"))
  (field ":dd.account_type"
    (label "Account Type")
    (options (option "checking" "Checking") (option "savings" "Savings")))
  (field ":dd.employee_signature" (label "Employee Signature"))
  (field ":dd.verified_by" (label "Verified By"))
  (field ":dd.verification_date" (label "Verification Date"))
  (field ":dd.prenote_status"
    (label "Prenote Status")
    (options (option "pending" "Pending")
      (option "verified" "Verified")
      (option "failed" "Failed")))
  (field ":dd.notes" (label "Notes")))

(define-document-localized "Direct Deposit Authorization"
  (locales en)
  (default-locale en))
```
