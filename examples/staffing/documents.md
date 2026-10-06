# Documents

```lisp
(export
  i-9-employment-eligibility
  w-4-federal-tax-withholding
  employee-handbook-acknowledgement
  direct-deposit-authorization
  state-tax-withholding
  background-check-consent
  identity-document-verification)

;; =============================================================================
;; I-9 Employment Eligibility Verification - Canonical Document
;; =============================================================================
(document i-9-employment-eligibility
  :description "Verify identity and employment authorization of new employees"
  (page
    employee-information
    :assignee
    employee
    :description
    "Employee Information and Attestation"
    :completion
    (completion start-i9-section-2 :entity Employee)
    (content
      :i9.section1_intro
      "# Section 1: Employee Information and Attestation\n\n**Employees must complete and sign Section 1 no later than the first day of employment.**\n\nEnter your full legal name and other information exactly as it appears on your identity and employment authorization documents. You may use a preparer/translator to assist you.\n\n---")
    (text :i9.last_name "Last Name" :required true :bind Employee.last-name)
    (text :i9.first_name "First Name" :required true :bind Employee.first-name)
    (text :i9.middle_initial "Middle Initial")
    (text :i9.other_last_names "Other Last Names Used")
    (text :i9.address "Address" :required true)
    (date
      :i9.date_of_birth
      "Date of Birth"
      :required
      true
      :bind
      Employee.date-of-birth
      :transform
      :string)
    (text :i9.ssn "Social Security Number" :required true :bind Employee.ssn)
    (text :i9.email "Email Address" :required true :bind Employee.email)
    (text :i9.phone "Phone Number" :bind Employee.phone)
    (content
      :i9.citizenship_intro
      "## Citizenship/Immigration Status\n\nCheck one of the following boxes to attest to your citizenship or immigration status:")
    (select
      :i9.citizenship_status "Citizenship Status"
      :required true
      :bind Employee.i9-citizenship-status
      (option "citizen" "A citizen of the United States")
      (option
        "noncitizen_national"
        "A noncitizen national of the United States")
      (option "permanent_resident" "A lawful permanent resident")
      (option "authorized_alien" "An alien authorized to work"))
    (text :i9.alien_number "Alien Registration Number/USCIS Number")
    (text :i9.i94_number "Form I-94 Admission Number")
    (date :i9.work_auth_expiry "Work Authorization Expiration Date")
    (content
      :i9.attestation_notice
      "## Attestation\n\nBy signing below, you attest under penalty of perjury that:\n- You are aware that federal law provides for imprisonment and/or fines for false statements\n- All information provided is true and correct\n- You are authorized to work in the United States")
    (checkbox
      :i9.employee_signature "Employee Signature"
      :required true
      :bind Employee.i9-section-1-signed))
  (page
    employer-review
    :assignee
    employer
    :description
    "Employer Review and Verification"
    :depends-on
    [employee-information]
    :completion
    (completion generate-i9-pdf :entity Employee)
    (content
      :i9.section2_intro
      "# Section 2: Employer Review and Verification\n\n**Employers must complete Section 2 within 3 business days of the employee's first day of employment.**\n\nExamine one document from **List A** (which establishes both identity and employment authorization) OR examine one document from **List B** (identity) AND one from **List C** (employment authorization).\n\n---\n\n## Acceptable Documents\n\n### List A (Identity AND Employment Authorization)\n- U.S. Passport or U.S. Passport Card\n- Permanent Resident Card (Form I-551)\n- Foreign passport with Form I-94 and endorsement\n- Employment Authorization Document (Form I-766)\n\n### List B (Identity Only)\n- Driver's license or state ID card\n- School ID card with photograph\n- Voter registration card\n- U.S. military card or draft record\n\n### List C (Employment Authorization Only)\n- Social Security card (unrestricted)\n- Birth certificate\n- U.S. Citizen ID Card (Form I-197)\n- Native American tribal document\n\n---")
    (content
      :i9.list_a_header
      "## List A Document\n*Complete this section if the employee presented a List A document.*")
    (text :i9.list_a_document "List A Document Title")
    (text :i9.list_a_doc_number "Document Number")
    (date :i9.list_a_expiry "Expiration Date")
    (text :i9.list_a_issuing_authority "Issuing Authority")
    (content
      :i9.list_bc_header
      "## List B + List C Documents\n*Complete this section if the employee did NOT present a List A document.*")
    (text :i9.list_b_document "List B Document Title")
    (text :i9.list_b_doc_number "Document Number")
    (date :i9.list_b_expiry "Expiration Date")
    (text :i9.list_b_issuing_authority "Issuing Authority")
    (text :i9.list_c_document "List C Document Title")
    (text :i9.list_c_doc_number "Document Number")
    (date :i9.list_c_expiry "Expiration Date")
    (text :i9.list_c_issuing_authority "Issuing Authority")
    (content
      :i9.employer_certification
      "---\n\n## Employer Certification\n\nBy signing below, you certify that:\n- You have examined the documents presented by the employee\n- The documents appear to be genuine and relate to the employee\n- The employee is authorized to work in the United States")
    (date
      :i9.employee_first_day
      "Employee's First Day of Employment"
      :required
      true)
    (checkbox :i9.employer_signature "Employer Signature" :required true)
    (text :i9.employer_name
      "Name of Employer or Authorized Representative"
      :required true)
    (text :i9.employer_title "Title" :required true)
    (text :i9.employer_org_name
      "Employer's Business or Organization Name"
      :required true)
    (text :i9.employer_org_address "Employer's Business Address" :required true)))
```

```lisp
;; =============================================================================
;; I-9 Employment Eligibility - English Locale
;; =============================================================================
(document-locale i-9-employment-eligibility "en"
  (role
    employee
    :label
    "Employee"
    :description
    "The new hire completing Section 1")
  (role
    employer
    :label
    "Employer/Authorized Representative"
    :description
    "Reviews identity and employment authorization documents")
  (section employee-information :label "Employee Information and Attestation")
  (section
    employer-review
    :label
    "Employer or Authorized Representative Review")
  (field :i9.last_name :label "Last Name")
  (field :i9.first_name :label "First Name")
  (field :i9.middle_initial :label "Middle Initial")
  (field :i9.other_last_names :label "Other Last Names Used")
  (field :i9.address :label "Address")
  (field :i9.date_of_birth :label "Date of Birth")
  (field :i9.ssn :label "Social Security Number")
  (field :i9.email :label "Email Address")
  (field :i9.phone :label "Phone Number")
  (field
    :i9.citizenship_status
    :label
    "Citizenship Status"
    (option "citizen" "A citizen of the United States")
    (option "noncitizen_national" "A noncitizen national of the United States")
    (option "permanent_resident" "A lawful permanent resident")
    (option "authorized_alien" "An alien authorized to work"))
  (field
    :i9.alien_number
    :label
    "Alien Registration Number/USCIS Number"
    :description
    "Required for permanent residents and authorized aliens")
  (field
    :i9.i94_number
    :label
    "Form I-94 Admission Number"
    :description
    "Required for certain authorized aliens")
  (field
    :i9.work_auth_expiry
    :label
    "Work Authorization Expiration Date"
    :description
    "Required for authorized aliens")
  (field
    :i9.employee_signature
    :label
    "Employee Signature"
    :description
    "I attest, under penalty of perjury, that the information provided is true and correct")
  (field
    :i9.list_a_document
    :label
    "List A Document Title"
    :description
    "e.g., U.S. Passport, Permanent Resident Card")
  (field :i9.list_a_doc_number :label "Document Number")
  (field :i9.list_a_expiry :label "Expiration Date")
  (field :i9.list_a_issuing_authority :label "Issuing Authority")
  (field
    :i9.list_b_document
    :label
    "List B Document Title (Identity)"
    :description
    "e.g., Driver's License, State ID")
  (field :i9.list_b_doc_number :label "Document Number")
  (field :i9.list_b_expiry :label "Expiration Date")
  (field :i9.list_b_issuing_authority :label "Issuing Authority")
  (field
    :i9.list_c_document
    :label
    "List C Document Title (Employment)"
    :description
    "e.g., Social Security Card, Birth Certificate")
  (field :i9.list_c_doc_number :label "Document Number")
  (field :i9.list_c_expiry :label "Expiration Date")
  (field :i9.list_c_issuing_authority :label "Issuing Authority")
  (field :i9.employee_first_day :label "Employee's First Day of Employment")
  (field
    :i9.employer_signature
    :label
    "Employer Signature"
    :description
    "I attest that I have examined the documents and they appear genuine")
  (field
    :i9.employer_name
    :label
    "Name of Employer or Authorized Representative")
  (field :i9.employer_title :label "Title")
  (field
    :i9.employer_org_name
    :label
    "Employer's Business or Organization Name")
  (field :i9.employer_org_address :label "Employer's Business Address"))
```

```lisp
;; =============================================================================
;; I-9 Employment Eligibility - Spanish Locale
;; =============================================================================
(document-locale i-9-employment-eligibility "es"
  (role
    employee
    :label
    "Empleado"
    :description
    "El nuevo empleado que completa la Seccion 1")
  (role
    employer
    :label
    "Empleador/Representante Autorizado"
    :description
    "Revisa documentos de identidad y autorizacion de empleo")
  (section employee-information :label "Informacion del Empleado y Declaracion")
  (section
    employer-review
    :label
    "Revision del Empleador o Representante Autorizado")
  (field :i9.last_name :label "Apellido")
  (field :i9.first_name :label "Nombre")
  (field :i9.middle_initial :label "Inicial del Segundo Nombre")
  (field :i9.other_last_names :label "Otros Apellidos Usados")
  (field :i9.address :label "Direccion")
  (field :i9.date_of_birth :label "Fecha de Nacimiento")
  (field :i9.ssn :label "Numero de Seguro Social")
  (field :i9.email :label "Correo Electronico")
  (field :i9.phone :label "Numero de Telefono")
  (field
    :i9.citizenship_status
    :label
    "Estado de Ciudadania"
    (option "citizen" "Ciudadano de los Estados Unidos")
    (option "noncitizen_national" "Nacional no ciudadano de los Estados Unidos")
    (option "permanent_resident" "Residente permanente legal")
    (option "authorized_alien" "Extranjero autorizado para trabajar"))
  (field
    :i9.alien_number
    :label
    "Numero de Registro de Extranjero/USCIS"
    :description
    "Requerido para residentes permanentes y extranjeros autorizados")
  (field
    :i9.i94_number
    :label
    "Numero de Admision del Formulario I-94"
    :description
    "Requerido para ciertos extranjeros autorizados")
  (field
    :i9.work_auth_expiry
    :label
    "Fecha de Vencimiento de Autorizacion de Trabajo"
    :description
    "Requerido para extranjeros autorizados")
  (field
    :i9.employee_signature
    :label
    "Firma del Empleado"
    :description
    "Declaro, bajo pena de perjurio, que la informacion proporcionada es verdadera y correcta")
  (field
    :i9.list_a_document
    :label
    "Titulo del Documento de Lista A"
    :description
    "ej., Pasaporte de EE.UU., Tarjeta de Residente Permanente")
  (field :i9.list_a_doc_number :label "Numero de Documento")
  (field :i9.list_a_expiry :label "Fecha de Vencimiento")
  (field :i9.list_a_issuing_authority :label "Autoridad Emisora")
  (field
    :i9.list_b_document
    :label
    "Titulo del Documento de Lista B (Identidad)"
    :description
    "ej., Licencia de Conducir, Identificacion Estatal")
  (field :i9.list_b_doc_number :label "Numero de Documento")
  (field :i9.list_b_expiry :label "Fecha de Vencimiento")
  (field :i9.list_b_issuing_authority :label "Autoridad Emisora")
  (field
    :i9.list_c_document
    :label
    "Titulo del Documento de Lista C (Empleo)"
    :description
    "ej., Tarjeta de Seguro Social, Certificado de Nacimiento")
  (field :i9.list_c_doc_number :label "Numero de Documento")
  (field :i9.list_c_expiry :label "Fecha de Vencimiento")
  (field :i9.list_c_issuing_authority :label "Autoridad Emisora")
  (field :i9.employee_first_day :label "Primer Dia de Trabajo del Empleado")
  (field
    :i9.employer_signature
    :label
    "Firma del Empleador"
    :description
    "Certifico que he examinado los documentos y parecen ser genuinos")
  (field
    :i9.employer_name
    :label
    "Nombre del Empleador o Representante Autorizado")
  (field :i9.employer_title :label "Titulo")
  (field
    :i9.employer_org_name
    :label
    "Nombre de la Empresa u Organizacion del Empleador")
  (field
    :i9.employer_org_address
    :label
    "Direccion de la Empresa del Empleador"))
(document-localized i-9-employment-eligibility ["en" "es"] :default-locale "en")
```

```lisp
;; =============================================================================
;; W-4 Federal Tax Withholding - Canonical Form
;; =============================================================================
(document w-4-federal-tax-withholding
  :description "Complete this form to determine federal income tax withholding"
  (page
    personal-information
    :assignee
    employee
    :description
    "Personal Information"
    (content
      :w4.intro
      "# Form W-4: Employee's Withholding Certificate\n\nComplete this form so your employer can withhold the correct federal income tax from your pay.\n\n---\n\n## Step 1: Personal Information")
    (text :w4.first_name "First Name" :required true)
    (text :w4.last_name "Last Name" :required true)
    (text :w4.ssn "Social Security Number" :required true)
    (text :w4.address "Home Address" :required true)
    (select
      :w4.filing_status "Filing Status"
      :required true
      (option "single" "Single or Married filing separately")
      (option "married" "Married filing jointly or Qualifying surviving spouse")
      (option "head_of_household" "Head of household")))
  (page
    multiple-jobs
    :assignee
    employee
    :description
    "Multiple Jobs or Spouse Works"
    (content
      :w4.step2_intro
      "## Step 2: Multiple Jobs or Spouse Works\n\nComplete this step if you:\n- Hold more than one job at a time, **OR**\n- Are married filing jointly and your spouse also works")
    (checkbox :w4.multiple_jobs_checkbox "Multiple jobs checkbox"))
  (page
    claim-dependents
    :assignee
    employee
    :description
    "Claim Dependents"
    (content
      :w4.step3_intro
      "## Step 3: Claim Dependents\n\nIf your total income will be $200,000 or less ($400,000 or less if married filing jointly), you may claim dependents.")
    (text :w4.qualifying_children "Number of qualifying children under age 17")
    (text :w4.other_dependents "Number of other dependents")
    (text :w4.total_dependents_credit "Total amount for dependents"))
  (page
    other-adjustments
    :assignee
    employee
    :description
    "Other Adjustments"
    (content
      :w4.step4_intro
      "## Step 4: Other Adjustments (Optional)\n\nUse this section for more accurate withholding or if you prefer to have more or less tax withheld.")
    (text :w4.other_income "Other income")
    (text :w4.deductions "Deductions")
    (text :w4.extra_withholding "Extra withholding per pay period"))
  (page
    sign-here
    :assignee
    employee
    :description
    "Sign Here"
    :completion
    (completion complete-w4-task :entity Employee)
    (content
      :w4.step5_intro
      "## Step 5: Sign Here\n\nUnder penalties of perjury, I declare that this certificate, to the best of my knowledge and belief, is true, correct, and complete.")
    (checkbox :w4.signature "Employee Signature" :required true)))
(document-locale w-4-federal-tax-withholding "en"
  (role employee :label "Employee")
  (section personal-information :label "Personal Information")
  (section multiple-jobs :label "Multiple Jobs or Spouse Works")
  (section claim-dependents :label "Claim Dependents")
  (section other-adjustments :label "Other Adjustments")
  (section sign-here :label "Sign Here")
  (field :w4.first_name :label "First Name and Middle Initial")
  (field :w4.last_name :label "Last Name")
  (field :w4.ssn :label "Social Security Number")
  (field :w4.address :label "Home Address (number, street, apt. no.)")
  (field
    :w4.filing_status
    :label
    "Filing Status"
    (option "single" "Single or Married filing separately")
    (option "married" "Married filing jointly or Qualifying surviving spouse")
    (option "head_of_household" "Head of household"))
  (field
    :w4.multiple_jobs_checkbox
    :label
    "Check here if: You hold more than one job, OR you are married filing jointly and your spouse also works"
    :description
    "Only check this box if there are only two jobs total.")
  (field
    :w4.qualifying_children
    :label
    "Number of qualifying children under age 17"
    :description
    "Multiply by $2,000")
  (field
    :w4.other_dependents
    :label
    "Number of other dependents"
    :description
    "Multiply by $500")
  (field
    :w4.total_dependents_credit
    :label
    "Total amount for dependents"
    :description
    "Add qualifying children amount plus other dependents amount")
  (field
    :w4.other_income
    :label
    "Other income (not from jobs)"
    :description
    "Income from interest, dividends, retirement, etc.")
  (field
    :w4.deductions
    :label
    "Deductions"
    :description
    "Estimated deductions other than the standard deduction")
  (field
    :w4.extra_withholding
    :label
    "Extra withholding per pay period"
    :description
    "Any additional tax you want withheld each pay period")
  (field
    :w4.signature
    :label
    "Employee Signature"
    :description
    "Under penalties of perjury, I declare that this certificate is complete and correct"))
(document-localized w-4-federal-tax-withholding ["en"] :default-locale "en")
```

```lisp
;; =============================================================================
;; Employee Handbook Acknowledgement - Canonical Form
;; =============================================================================
(document employee-handbook-acknowledgement
  :description "Confirm you have received and reviewed the employee handbook"
  (page
    handbook-acknowledgement
    :assignee
    employee
    :description
    "Handbook Acknowledgement"
    :completion
    (completion complete-handbook-task :entity Employee)
    (content
      :handbook.intro
      "# Employee Handbook Acknowledgement\n\nWelcome to the team! As part of your onboarding process, please review and acknowledge receipt of the Employee Handbook.\n\nThe Employee Handbook contains important information about:\n\n- **Company Policies** - Workplace conduct, dress code, attendance\n- **Benefits** - Health insurance, PTO, retirement plans\n- **Safety Procedures** - Emergency protocols, reporting incidents\n- **Employment Terms** - At-will employment, termination procedures\n\nPlease read the handbook carefully before completing this acknowledgement.\n\n---\n\n## Acknowledgements\n\nPlease check each box to confirm your understanding:")
    (checkbox
      :handbook.received "I have received the employee handbook"
      :required true)
    (checkbox :handbook.read "I have read the employee handbook" :required true)
    (checkbox
      :handbook.agree_to_comply "I agree to comply with handbook policies"
      :required true)
    (content
      :handbook.at_will_notice
      "---\n\n## Important Notice\n\n> **At-Will Employment:** Your employment with the company is at-will. This means that either you or the company may terminate the employment relationship at any time, with or without cause, and with or without notice.\n>\n> The Employee Handbook is not an employment contract and does not guarantee employment for any specific period of time.")
    (checkbox
      :handbook.understand_at_will "I understand the at-will employment notice"
      :required true)
    (checkbox
      :handbook.understand_changes "I understand the handbook may be updated"
      :required true)
    (content
      :handbook.questions_section
      "---\n\n## Questions?\n\nIf you have any questions about the handbook or company policies, please note them below or contact Human Resources directly.")
    (text :handbook.questions "Questions")
    (content
      :handbook.signature_section
      "---\n\n## Signature\n\nBy signing below, you confirm all of the acknowledgements above.")
    (checkbox :handbook.signature "Employee Signature" :required true)))
(document-locale employee-handbook-acknowledgement "en"
  (role employee :label "Employee")
  (section handbook-acknowledgement :label "Handbook Acknowledgement")
  (field
    :handbook.received
    :label
    "I have received a copy of the Employee Handbook")
  (field
    :handbook.read
    :label
    "I have read and understand the Employee Handbook")
  (field
    :handbook.agree_to_comply
    :label
    "I agree to comply with all policies in the Employee Handbook")
  (field
    :handbook.understand_at_will
    :label
    "I understand the at-will employment relationship")
  (field
    :handbook.understand_changes
    :label
    "I understand the handbook may be changed at any time at the company's discretion")
  (field :handbook.questions :label "Questions or Comments")
  (field
    :handbook.signature
    :label
    "Employee Signature"
    :description
    "By signing, you confirm all of the acknowledgements above"))
(document-localized employee-handbook-acknowledgement ["en"]
  :default-locale "en")
```

```lisp
;; =============================================================================
;; Direct Deposit Authorization - Canonical Form
;; =============================================================================
(document direct-deposit-authorization
  :description
    "Authorize direct deposit of payroll funds to employee bank account"
  (page
    bank-information
    :assignee
    employee
    :description
    "Bank Information"
    (content
      :dd.intro
      "# Direct Deposit Authorization\n\nPlease provide your bank account information below to set up direct deposit for your payroll. Your information is encrypted and stored securely.\n\n---")
    (text :dd.bank_name "Bank Name" :required true)
    (text :dd.routing_number "Routing Number" :required true)
    (text :dd.account_number "Account Number" :required true)
    (select
      :dd.account_type "Account Type"
      :required true
      (option "checking" "Checking")
      (option "savings" "Savings"))
    (content
      :dd.authorization_notice
      "---\n\n## Authorization\n\nBy signing below, I authorize my employer to deposit my pay directly into the bank account specified above. I understand that this authorization will remain in effect until I provide written notice of cancellation.")
    (checkbox :dd.employee_signature "Employee Signature" :required true))
  (page
    employer-verification
    :assignee
    employer
    :description
    "Employer Verification"
    :depends-on
    [bank-information]
    :completion
    (completion complete-direct-deposit-task :entity Employee)
    (content
      :dd.verification_intro
      "# Employer Verification\n\nVerify the employee's bank information and confirm prenote status.\n\n---")
    (text :dd.verified_by "Verified By" :required true)
    (date :dd.verification_date "Verification Date" :required true)
    (select
      :dd.prenote_status "Prenote Status"
      :required true
      (option "pending" "Pending")
      (option "verified" "Verified")
      (option "failed" "Failed"))
    (text :dd.notes "Notes")))
(document-locale direct-deposit-authorization "en"
  (role employee :label "Employee")
  (role employer :label "Employer/Payroll")
  (section bank-information :label "Bank Information")
  (section employer-verification :label "Employer Verification")
  (field :dd.bank_name :label "Bank or Financial Institution Name")
  (field :dd.routing_number :label "Routing Number (9 digits)")
  (field :dd.account_number :label "Account Number")
  (field
    :dd.account_type
    :label
    "Account Type"
    (option "checking" "Checking Account")
    (option "savings" "Savings Account"))
  (field
    :dd.employee_signature
    :label
    "Employee Signature"
    :description
    "I authorize direct deposit to the account specified above")
  (field :dd.verified_by :label "Verified By")
  (field :dd.verification_date :label "Verification Date")
  (field
    :dd.prenote_status
    :label
    "Prenote Status"
    (option "pending" "Pending Verification")
    (option "verified" "Verified")
    (option "failed" "Verification Failed"))
  (field :dd.notes :label "Notes"))
(document-localized direct-deposit-authorization ["en"] :default-locale "en")
```

```lisp
;; =============================================================================
;; State Tax Withholding - Canonical Form
;; =============================================================================
(document state-tax-withholding
  :description "Employee state income tax withholding elections"
  (page
    state-tax-info
    :assignee
    employee
    :description
    "State Tax Information"
    :completion
    (completion complete-state-tax-task :entity Employee)
    (content
      :st.intro
      "# State Tax Withholding\n\nComplete this form to indicate your state income tax withholding preferences. This information will be used to calculate state tax deductions from your paycheck.\n\n---")
    (select
      :st.state "State"
      :required true
      (option "AL" "Alabama")
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
      (option "WY" "Wyoming"))
    (select
      :st.filing_status "Filing Status"
      :required true
      (option "single" "Single")
      (option "married" "Married")
      (option "married_separate" "Married Filing Separately")
      (option "head_of_household" "Head of Household"))
    (text :st.allowances "Number of Allowances" :required true)
    (text :st.additional_withholding "Additional Withholding")
    (checkbox :st.exempt "Exempt from state withholding")
    (content
      :st.certification_notice
      "---\n\n## Certification\n\nUnder penalties of perjury, I certify that the information on this form is true, correct, and complete.")
    (checkbox :st.employee_signature "Employee Signature" :required true)))
(document-locale state-tax-withholding "en"
  (role employee :label "Employee")
  (section state-tax-info :label "State Tax Information")
  (field :st.state :label "Work State")
  (field
    :st.filing_status
    :label
    "State Filing Status"
    (option "single" "Single")
    (option "married" "Married Filing Jointly")
    (option "married_separate" "Married Filing Separately")
    (option "head_of_household" "Head of Household"))
  (field
    :st.allowances
    :label
    "Number of Allowances"
    :description
    "Enter the number of withholding allowances")
  (field
    :st.additional_withholding
    :label
    "Additional Withholding Amount"
    :description
    "Additional amount to withhold per pay period")
  (field
    :st.exempt
    :label
    "Claim Exemption"
    :description
    "Check if you are exempt from state income tax withholding")
  (field
    :st.employee_signature
    :label
    "Employee Signature"
    :description
    "Under penalties of perjury, I certify this information is correct"))
(document-localized state-tax-withholding ["en"] :default-locale "en")
```

```lisp
;; =============================================================================
;; Background Check Consent - Canonical Form
;; =============================================================================
(document background-check-consent
  :description "Employee authorization for background check verification"
  (page
    consent-and-authorization
    :assignee
    employee
    :description
    "Consent and Authorization"
    :completion
    (completion complete-bgc-task :entity Employee)
    (text :bgc.full_name "Full Legal Name" :required true)
    (text :bgc.email "Email Address" :required true)
    (checkbox
      :bgc.consent_acknowledgment
        "I consent to a background check being performed"
      :required true)
    (checkbox
      :bgc.fcra_acknowledgment "I acknowledge my rights under the FCRA"
      :required true)
    (checkbox :bgc.signature "Signature" :required true)))
(document-locale background-check-consent "en"
  (section consent-and-authorization :label "Consent and Authorization")
  (field :bgc.full_name :label "Full Legal Name")
  (field :bgc.email :label "Email Address")
  (field
    :bgc.consent_acknowledgment
    :label
    "I consent to a background check being performed")
  (field
    :bgc.fcra_acknowledgment
    :label
    "I acknowledge my rights under the Fair Credit Reporting Act (FCRA)")
  (field :bgc.signature :label "Signature"))
(document-localized background-check-consent ["en"] :default-locale "en")
```

```lisp
;; =============================================================================
;; Identity Document Verification - Canonical Form
;; =============================================================================
(document identity-document-verification
  :description "Upload and verify identity documents with HR review"
  (page
    document-upload
    :assignee
    employee
    :description
    "Document Upload"
    (select
      :idv.primary_doc_type "Primary Document Type"
      :required true
      (option "passport" "Passport")
      (option "drivers_license" "Driver's License")
      (option "state_id" "State ID")
      (option "national_id" "National ID"))
    (text :idv.primary_doc_file "Primary Document Upload" :required true)
    (select
      :idv.secondary_doc_type "Secondary Document Type"
      (option "utility_bill" "Utility Bill")
      (option "bank_statement" "Bank Statement")
      (option "tax_document" "Tax Document"))
    (text :idv.secondary_doc_file "Secondary Document Upload"))
  (page
    verification-results
    :assignee
    system
    :description
    "Verification Results"
    :depends-on
    [document-upload]
    (text :idv.verification_status "Verification Status")
    (text :idv.confidence_score "Confidence Score")
    (text :idv.verification_details "Verification Details"))
  (page
    hr-review
    :assignee
    hr-admin
    :description
    "HR Review"
    :depends-on
    [verification-results]
    :completion
    (completion complete-idv-task :entity Employee)
    (select
      :idv.review_decision "Review Decision"
      :required true
      (option "approved" "Approved")
      (option "rejected" "Rejected")
      (option "additional_docs_required" "Additional Documents Required"))
    (text :idv.review_notes "Review Notes")))
(document-locale identity-document-verification "en"
  (section document-upload :label "Document Upload")
  (section verification-results :label "Verification Results")
  (section hr-review :label "HR Review")
  (field
    :idv.primary_doc_type
    :label
    "Primary Document Type"
    (option "passport" "Passport")
    (option "drivers_license" "Driver's License")
    (option "state_id" "State ID")
    (option "national_id" "National ID"))
  (field :idv.primary_doc_file :label "Primary Document Upload")
  (field
    :idv.secondary_doc_type
    :label
    "Secondary Document Type"
    (option "utility_bill" "Utility Bill")
    (option "bank_statement" "Bank Statement")
    (option "tax_document" "Tax Document"))
  (field :idv.secondary_doc_file :label "Secondary Document Upload")
  (field :idv.verification_status :label "Verification Status")
  (field :idv.confidence_score :label "Confidence Score")
  (field :idv.verification_details :label "Verification Details")
  (field
    :idv.review_decision
    :label
    "Review Decision"
    (option "approved" "Approved")
    (option "rejected" "Rejected")
    (option "additional_docs_required" "Additional Documents Required"))
  (field :idv.review_notes :label "Review Notes"))
(document-localized identity-document-verification ["en"] :default-locale "en")
```

```lisp
;; =============================================================================
;; PDF Mapping Definitions - Canonical Form
;; =============================================================================
```
