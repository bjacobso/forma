---
title: State Tax Withholding
---

# State Tax Withholding

Most states impose an income tax that is withheld from employee paychecks. This form captures the employee's state tax withholding preferences, including filing status, number of allowances, and any additional withholding or exemption elections.

Note that some states (Alaska, Florida, Nevada, New Hampshire, South Dakota, Tennessee, Texas, Washington, Wyoming) do not have a state income tax. Employees working in these states may still need to complete this form if they have nexus in a taxing state.

## State Tax Information

```lisp
(define-document "State Tax Withholding"
  (description "Employee state income tax withholding elections")

  (form-page (section-id "state-tax-info")
    (assignee employee)
    (page-description "State Tax Information")

    (form-field
      :content :st.intro
      (content
        "# State Tax Withholding\n\nComplete this form to indicate your state income tax withholding preferences. This information will be used to calculate state tax deductions from your paycheck.\n\n---"))

    (form-field
      :select :st.state
      (label "State")
      (form-required true)
      (options (option "AL" "Alabama")
        (option "AK" "Alaska")
        (option "AZ" "Arizona")
        (option "AR" "Arkansas")
        (option "CA" "California")
        (option "CO" "Colorado")
        (option "CT" "Connecticut")
        (option "DE" "Delaware")
        (option "FL" "Florida")
        (option "GA" "Georgia")
        (option "HI" "Hawaii")
        (option "ID" "Idaho")
        (option "IL" "Illinois")
        (option "IN" "Indiana")
        (option "IA" "Iowa")
        (option "KS" "Kansas")
        (option "KY" "Kentucky")
        (option "LA" "Louisiana")
        (option "ME" "Maine")
        (option "MD" "Maryland")
        (option "MA" "Massachusetts")
        (option "MI" "Michigan")
        (option "MN" "Minnesota")
        (option "MS" "Mississippi")
        (option "MO" "Missouri")
        (option "MT" "Montana")
        (option "NE" "Nebraska")
        (option "NV" "Nevada")
        (option "NH" "New Hampshire")
        (option "NJ" "New Jersey")
        (option "NM" "New Mexico")
        (option "NY" "New York")
        (option "NC" "North Carolina")
        (option "ND" "North Dakota")
        (option "OH" "Ohio")
        (option "OK" "Oklahoma")
        (option "OR" "Oregon")
        (option "PA" "Pennsylvania")
        (option "RI" "Rhode Island")
        (option "SC" "South Carolina")
        (option "SD" "South Dakota")
        (option "TN" "Tennessee")
        (option "TX" "Texas")
        (option "UT" "Utah")
        (option "VT" "Vermont")
        (option "VA" "Virginia")
        (option "WA" "Washington")
        (option "WV" "West Virginia")
        (option "WI" "Wisconsin")
        (option "WY" "Wyoming")))

    (form-field
      :select :st.filing_status
      (label "Filing Status")
      (form-required true)
      (options (option "single" "Single")
        (option "married" "Married")
        (option "married_separate" "Married Filing Separately")
        (option "head_of_household" "Head of Household")))

    (form-field
      :text :st.allowances
      (label "Number of Allowances")
      (form-required true))
    (form-field
      :text :st.additional_withholding
      (label "Additional Withholding"))
    (form-field :boolean :st.exempt (label "Exempt from state withholding"))

    (form-field
      :content :st.certification_notice
      (content
        "---\n\n## Certification\n\nUnder penalties of perjury, I certify that the information on this form is true, correct, and complete."))

    (form-field
      :boolean :st.employee_signature
      (label "Employee Signature")
      (form-required true))))
```

## Locale: English

```lisp
(define-document-locale "State Tax Withholding"
  en
  (section "state-tax-info" (label "State Tax Information"))
  (field ":st.state" (label "State"))
  (field ":st.filing_status"
    (label "Filing Status")
    (options (option "single" "Single")
      (option "married" "Married")
      (option "married_separate" "Married Filing Separately")
      (option "head_of_household" "Head of Household")))
  (field ":st.allowances" (label "Number of Allowances"))
  (field ":st.additional_withholding"
    (label "Additional Withholding Per Pay Period"))
  (field ":st.exempt" (label "Exempt from state withholding"))
  (field ":st.employee_signature" (label "Employee Signature")))

(define-document-localized "State Tax Withholding"
  (locales en)
  (default-locale en))
```
