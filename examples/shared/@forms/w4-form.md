---
title: W-4 Federal Tax Withholding
---

# W-4 Federal Tax Withholding

IRS Form W-4 (Employee's Withholding Certificate) determines how much federal income tax is withheld from an employee's paycheck. The form was significantly redesigned in 2020 to replace the allowances system with a more straightforward approach.

Employees should complete a new W-4 when starting a new job, or when their financial situation changes (marriage, divorce, new dependents, etc.).

## Step 1: Personal Information

Basic identifying information and filing status. The filing status affects the standard deduction and tax brackets applied to withholding calculations.

```lisp
(define-document "W-4 Federal Tax Withholding"
  (description "Complete this form to determine federal income tax withholding")

  ;; Step 1: Personal Information
  (form-page
    (section-id "personal-information")
    (assignee employee)
    (page-description "Personal Information")

    (form-field :content :w4.intro
      (content "# Form W-4: Employee's Withholding Certificate\n\nComplete this form so your employer can withhold the correct federal income tax from your pay.\n\n---\n\n## Step 1: Personal Information"))

    (form-field :text :w4.first_name
      (label "First Name")
      (form-required true))
    (form-field :text :w4.last_name
      (label "Last Name")
      (form-required true))
    (form-field :text :w4.ssn
      (label "Social Security Number")
      (form-required true))
    (form-field :text :w4.address
      (label "Home Address")
      (form-required true))
    (form-field :select :w4.filing_status
      (label "Filing Status")
      (form-required true)
      (options
        (option "single" "Single or Married filing separately")
        (option "married" "Married filing jointly or Qualifying surviving spouse")
        (option "head_of_household" "Head of household"))))
```

## Step 2: Multiple Jobs or Spouse Works

This step applies if the employee holds more than one job at a time, or is married filing jointly and their spouse also works. Completing this step ensures more accurate withholding across multiple income sources.

```lisp
;; Step 2: Multiple Jobs or Spouse Works
(form-page (section-id "multiple-jobs")
  (assignee employee)
  (page-description "Multiple Jobs or Spouse Works")

  (form-field
    :content :w4.step2_intro
    (content
      "## Step 2: Multiple Jobs or Spouse Works\n\nComplete this step if you:\n- Hold more than one job at a time, **OR**\n- Are married filing jointly and your spouse also works"))

  (form-field
    :boolean :w4.multiple_jobs_checkbox
    (label "Multiple jobs checkbox")))
```

## Step 3: Claim Dependents

Employees with qualifying dependents can reduce their withholding. The child tax credit is $2,000 per qualifying child under age 17, and $500 per other dependent. This step is only available if total income is $200,000 or less ($400,000 for married filing jointly).

```lisp
;; Step 3: Claim Dependents
(form-page (section-id "claim-dependents")
  (assignee employee)
  (page-description "Claim Dependents")

  (form-field
    :content :w4.step3_intro
    (content
      "## Step 3: Claim Dependents\n\nIf your total income will be $200,000 or less ($400,000 or less if married filing jointly), you may claim dependents."))

  (form-field
    :text :w4.qualifying_children
    (label "Number of qualifying children under age 17"))
  (form-field :text :w4.other_dependents (label "Number of other dependents"))
  (form-field
    :text :w4.total_dependents_credit
    (label "Total amount for dependents")))
```

## Step 4: Other Adjustments (Optional)

Fine-tune withholding for non-job income (interest, dividends, retirement distributions), additional deductions beyond the standard deduction, or extra withholding per pay period.

```lisp
;; Step 4: Other Adjustments
(form-page (section-id "other-adjustments")
  (assignee employee)
  (page-description "Other Adjustments")

  (form-field
    :content :w4.step4_intro
    (content
      "## Step 4: Other Adjustments (Optional)\n\nUse this section for more accurate withholding or if you prefer to have more or less tax withheld."))

  (form-field :text :w4.other_income (label "Other income"))
  (form-field :text :w4.deductions (label "Deductions"))
  (form-field
    :text :w4.extra_withholding
    (label "Extra withholding per pay period")))
```

## Step 5: Sign Here

The employee's signature under penalty of perjury certifies that the information is true and correct.

```lisp
  ;; Step 5: Sign Here
  (form-page
    (section-id "sign-here")
    (assignee employee)
    (page-description "Sign Here")

    (form-field :content :w4.step5_intro
      (content "## Step 5: Sign Here\n\nUnder penalties of perjury, I declare that this certificate, to the best of my knowledge and belief, is true, correct, and complete."))

    (form-field :boolean :w4.signature
      (label "Employee Signature")
      (form-required true))))
```

## Locale: English

```lisp
(define-document-locale "W-4 Federal Tax Withholding"
  en
  (role "employee" (label "Employee"))
  (section "personal-information" (label "Personal Information"))
  (section "multiple-jobs" (label "Multiple Jobs or Spouse Works"))
  (section "claim-dependents" (label "Claim Dependents"))
  (section "other-adjustments" (label "Other Adjustments"))
  (section "sign-here" (label "Sign Here"))
  (field ":w4.first_name" (label "First Name and Middle Initial"))
  (field ":w4.last_name" (label "Last Name"))
  (field ":w4.ssn" (label "Social Security Number"))
  (field ":w4.address" (label "Home Address (number, street, apt. no.)"))
  (field ":w4.filing_status"
    (label "Filing Status")
    (options (option "single" "Single or Married filing separately")
      (option "married" "Married filing jointly or Qualifying surviving spouse")
      (option "head_of_household" "Head of household")))
  (field ":w4.multiple_jobs_checkbox"
    (label
      "Check here if: You hold more than one job, OR you are married filing jointly and your spouse also works")
    (description "Only check this box if there are only two jobs total."))
  (field ":w4.qualifying_children"
    (label "Number of qualifying children under age 17")
    (description "Multiply by $2,000"))
  (field ":w4.other_dependents"
    (label "Number of other dependents")
    (description "Multiply by $500"))
  (field ":w4.total_dependents_credit"
    (label "Total amount for dependents")
    (description "Add qualifying children amount plus other dependents amount"))
  (field ":w4.other_income"
    (label "Other income (not from jobs)")
    (description "Income from interest, dividends, retirement, etc."))
  (field ":w4.deductions"
    (label "Deductions")
    (description "Estimated deductions other than the standard deduction"))
  (field ":w4.extra_withholding"
    (label "Extra withholding per pay period")
    (description "Any additional tax you want withheld each pay period"))
  (field ":w4.signature"
    (label "Employee Signature")
    (description
      "Under penalties of perjury, I declare that this certificate is complete and correct")))

(define-document-localized "W-4 Federal Tax Withholding"
  (locales en)
  (default-locale en))
```
