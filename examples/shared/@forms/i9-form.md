---
title: I-9 Employment Eligibility Verification
---

# I-9 Employment Eligibility Verification

The USCIS Form I-9 is required by federal law for every new hire in the United States. It verifies the identity and employment authorization of individuals hired for employment. Employers must complete Form I-9 for each person they hire, regardless of citizenship or national origin.

**Key deadlines:**

- **Section 1** (employee): Must be completed no later than the first day of employment
- **Section 2** (employer): Must be completed within 3 business days of the employee's first day

```lisp
(define-document "I-9 Employment Eligibility"
  (description "Verify identity and employment authorization of new employees"))
```

## Section 1: Employee Information and Attestation

The employee provides personal information and attests to their citizenship or immigration status. This section captures the employee's legal name, address, date of birth, Social Security Number, and work authorization status.

```lisp
(form-page "I-9 Employment Eligibility"
  (section-id "employee-information")
  (assignee employee)
  (completion-action "start-i9-section-2" "Employee")
  (page-description "Employee Information and Attestation")

  (form-field
    :content :i9.section1_intro
    (content
      "# Section 1: Employee Information and Attestation\n\n**Employees must complete and sign Section 1 no later than the first day of employment.**\n\nEnter your full legal name and other information exactly as it appears on your identity and employment authorization documents. You may use a preparer/translator to assist you.\n\n---"))

  (form-field :text :i9.last_name (label "Last Name") (form-required true))
  (form-field :text :i9.first_name (label "First Name") (form-required true))
  (form-field :text :i9.middle_initial (label "Middle Initial"))
  (form-field :text :i9.other_last_names (label "Other Last Names Used"))
  (form-field :text :i9.address (label "Address") (form-required true))
  (form-field
    :date :i9.date_of_birth
    (label "Date of Birth")
    (form-required true))
  (form-field
    :text :i9.ssn
    (label "Social Security Number")
    (form-required true))
  (form-field :text :i9.email (label "Email Address") (form-required true))
  (form-field :text :i9.phone (label "Phone Number"))

  (form-field
    :content :i9.citizenship_intro
    (content
      "## Citizenship/Immigration Status\n\nCheck one of the following boxes to attest to your citizenship or immigration status:"))

  (form-field
    :select :i9.citizenship_status
    (label "Citizenship Status")
    (form-required true)
    (options (option "citizen" "A citizen of the United States")
      (option "noncitizen_national"
        "A noncitizen national of the United States")
      (option "permanent_resident" "A lawful permanent resident")
      (option "authorized_alien" "An alien authorized to work")))

  (form-field
    :text :i9.alien_number
    (label "Alien Registration Number/USCIS Number"))
  (form-field :text :i9.i94_number (label "Form I-94 Admission Number"))
  (form-field
    :date :i9.work_auth_expiry
    (label "Work Authorization Expiration Date"))

  (form-field
    :content :i9.attestation_notice
    (content
      "## Attestation\n\nBy signing below, you attest under penalty of perjury that:\n- You are aware that federal law provides for imprisonment and/or fines for false statements\n- All information provided is true and correct\n- You are authorized to work in the United States"))

  (form-field
    :boolean :i9.employee_signature
    (label "Employee Signature")
    (form-required true)))
```

## Section 2: Employer Review and Verification

The employer (or authorized representative) examines the employee's identity and employment authorization documents. The employer must review original documents -- photocopies are not acceptable.

### Acceptable Documents

**List A** documents establish both identity AND employment authorization:

- U.S. Passport or U.S. Passport Card
- Permanent Resident Card (Form I-551)
- Foreign passport with Form I-94 and endorsement
- Employment Authorization Document (Form I-766)

**List B** documents establish identity only:

- Driver's license or state ID card
- School ID card with photograph
- Voter registration card
- U.S. military card or draft record

**List C** documents establish employment authorization only:

- Social Security card (unrestricted)
- Birth certificate
- U.S. Citizen ID Card (Form I-197)
- Native American tribal document

The employer must examine either one List A document, OR one List B document AND one List C document.

```lisp
(form-page "I-9 Employment Eligibility"
  (section-id "employer-review")
  (assignee employer)
  (depends-on "employee-information")
  (page-description "Employer Review and Verification")

  (form-field
    :content :i9.section2_intro
    (content
      "# Section 2: Employer Review and Verification\n\n**Employers must complete Section 2 within 3 business days of the employee's first day of employment.**\n\nExamine one document from **List A** (which establishes both identity and employment authorization) OR examine one document from **List B** (identity) AND one from **List C** (employment authorization).\n\n---\n\n## Acceptable Documents\n\n### List A (Identity AND Employment Authorization)\n- U.S. Passport or U.S. Passport Card\n- Permanent Resident Card (Form I-551)\n- Foreign passport with Form I-94 and endorsement\n- Employment Authorization Document (Form I-766)\n\n### List B (Identity Only)\n- Driver's license or state ID card\n- School ID card with photograph\n- Voter registration card\n- U.S. military card or draft record\n\n### List C (Employment Authorization Only)\n- Social Security card (unrestricted)\n- Birth certificate\n- U.S. Citizen ID Card (Form I-197)\n- Native American tribal document\n\n---"))

  (form-field
    :content :i9.list_a_header
    (content
      "## List A Document\n*Complete this section if the employee presented a List A document.*"))

  (form-field :text :i9.list_a_document (label "List A Document Title"))
  (form-field :text :i9.list_a_doc_number (label "Document Number"))
  (form-field :date :i9.list_a_expiry (label "Expiration Date"))
  (form-field :text :i9.list_a_issuing_authority (label "Issuing Authority"))

  (form-field
    :content :i9.list_bc_header
    (content
      "## List B + List C Documents\n*Complete this section if the employee did NOT present a List A document.*"))

  (form-field :text :i9.list_b_document (label "List B Document Title"))
  (form-field :text :i9.list_b_doc_number (label "Document Number"))
  (form-field :date :i9.list_b_expiry (label "Expiration Date"))
  (form-field :text :i9.list_b_issuing_authority (label "Issuing Authority"))
  (form-field :text :i9.list_c_document (label "List C Document Title"))
  (form-field :text :i9.list_c_doc_number (label "Document Number"))
  (form-field :date :i9.list_c_expiry (label "Expiration Date"))
  (form-field :text :i9.list_c_issuing_authority (label "Issuing Authority"))

  (form-field
    :content :i9.employer_certification
    (content
      "---\n\n## Employer Certification\n\nBy signing below, you certify that:\n- You have examined the documents presented by the employee\n- The documents appear to be genuine and relate to the employee\n- The employee is authorized to work in the United States"))

  (form-field
    :date :i9.employee_first_day
    (label "Employee's First Day of Employment")
    (form-required true))
  (form-field
    :boolean :i9.employer_signature
    (label "Employer Signature")
    (form-required true))
  (form-field
    :text :i9.employer_name
    (label "Name of Employer or Authorized Representative")
    (form-required true))
  (form-field :text :i9.employer_title (label "Title") (form-required true))
  (form-field
    :text :i9.employer_org_name
    (label "Employer's Business or Organization Name")
    (form-required true))
  (form-field
    :text :i9.employer_org_address
    (label "Employer's Business Address")
    (form-required true)))
```

## Locale: English

```lisp
(define-document-locale "I-9 Employment Eligibility"
  en
  (role "employee"
    (label "Employee")
    (description "The new hire completing Section 1"))
  (role "employer"
    (label "Employer/Authorized Representative")
    (description "Reviews identity and employment authorization documents"))
  (section "employee-information"
    (label "Employee Information and Attestation"))
  (section "employer-review"
    (label "Employer or Authorized Representative Review"))
  (field ":i9.last_name" (label "Last Name"))
  (field ":i9.first_name" (label "First Name"))
  (field ":i9.middle_initial" (label "Middle Initial"))
  (field ":i9.other_last_names" (label "Other Last Names Used"))
  (field ":i9.address" (label "Address"))
  (field ":i9.date_of_birth" (label "Date of Birth"))
  (field ":i9.ssn" (label "Social Security Number"))
  (field ":i9.email" (label "Email Address"))
  (field ":i9.phone" (label "Phone Number"))
  (field ":i9.citizenship_status"
    (label "Citizenship Status")
    (options (option "citizen" "A citizen of the United States")
      (option "noncitizen_national"
        "A noncitizen national of the United States")
      (option "permanent_resident" "A lawful permanent resident")
      (option "authorized_alien" "An alien authorized to work")))
  (field ":i9.alien_number"
    (label "Alien Registration Number/USCIS Number")
    (description "Required for permanent residents and authorized aliens"))
  (field ":i9.i94_number"
    (label "Form I-94 Admission Number")
    (description "Required for certain authorized aliens"))
  (field ":i9.work_auth_expiry"
    (label "Work Authorization Expiration Date")
    (description "Required for authorized aliens"))
  (field ":i9.employee_signature"
    (label "Employee Signature")
    (description
      "I attest, under penalty of perjury, that the information provided is true and correct"))
  (field ":i9.list_a_document"
    (label "List A Document Title")
    (description "e.g., U.S. Passport, Permanent Resident Card"))
  (field ":i9.list_a_doc_number" (label "Document Number"))
  (field ":i9.list_a_expiry" (label "Expiration Date"))
  (field ":i9.list_a_issuing_authority" (label "Issuing Authority"))
  (field ":i9.list_b_document"
    (label "List B Document Title (Identity)")
    (description "e.g., Driver's License, State ID"))
  (field ":i9.list_b_doc_number" (label "Document Number"))
  (field ":i9.list_b_expiry" (label "Expiration Date"))
  (field ":i9.list_b_issuing_authority" (label "Issuing Authority"))
  (field ":i9.list_c_document"
    (label "List C Document Title (Employment)")
    (description "e.g., Social Security Card, Birth Certificate"))
  (field ":i9.list_c_doc_number" (label "Document Number"))
  (field ":i9.list_c_expiry" (label "Expiration Date"))
  (field ":i9.list_c_issuing_authority" (label "Issuing Authority"))
  (field ":i9.employee_first_day" (label "Employee's First Day of Employment"))
  (field ":i9.employer_signature"
    (label "Employer Signature")
    (description
      "I attest that I have examined the documents and they appear genuine"))
  (field ":i9.employer_name"
    (label "Name of Employer or Authorized Representative"))
  (field ":i9.employer_title" (label "Title"))
  (field ":i9.employer_org_name"
    (label "Employer's Business or Organization Name"))
  (field ":i9.employer_org_address" (label "Employer's Business Address")))
```

## Locale: Spanish

```lisp
(define-document-locale "I-9 Employment Eligibility"
  es
  (role "employee"
    (label "Empleado")
    (description "El nuevo empleado que completa la Seccion 1"))
  (role "employer"
    (label "Empleador/Representante Autorizado")
    (description "Revisa documentos de identidad y autorizacion de empleo"))
  (section "employee-information"
    (label "Informacion del Empleado y Declaracion"))
  (section "employer-review"
    (label "Revision del Empleador o Representante Autorizado"))
  (field ":i9.last_name" (label "Apellido"))
  (field ":i9.first_name" (label "Nombre"))
  (field ":i9.middle_initial" (label "Inicial del Segundo Nombre"))
  (field ":i9.other_last_names" (label "Otros Apellidos Usados"))
  (field ":i9.address" (label "Direccion"))
  (field ":i9.date_of_birth" (label "Fecha de Nacimiento"))
  (field ":i9.ssn" (label "Numero de Seguro Social"))
  (field ":i9.email" (label "Correo Electronico"))
  (field ":i9.phone" (label "Numero de Telefono"))
  (field ":i9.citizenship_status"
    (label "Estado de Ciudadania")
    (options (option "citizen" "Ciudadano de los Estados Unidos")
      (option "noncitizen_national"
        "Nacional no ciudadano de los Estados Unidos")
      (option "permanent_resident" "Residente permanente legal")
      (option "authorized_alien" "Extranjero autorizado para trabajar")))
  (field ":i9.alien_number"
    (label "Numero de Registro de Extranjero/USCIS")
    (description
      "Requerido para residentes permanentes y extranjeros autorizados"))
  (field ":i9.i94_number"
    (label "Numero de Admision del Formulario I-94")
    (description "Requerido para ciertos extranjeros autorizados"))
  (field ":i9.work_auth_expiry"
    (label "Fecha de Vencimiento de Autorizacion de Trabajo")
    (description "Requerido para extranjeros autorizados"))
  (field ":i9.employee_signature"
    (label "Firma del Empleado")
    (description
      "Declaro, bajo pena de perjurio, que la informacion proporcionada es verdadera y correcta"))
  (field ":i9.list_a_document"
    (label "Titulo del Documento de Lista A")
    (description "ej., Pasaporte de EE.UU., Tarjeta de Residente Permanente"))
  (field ":i9.list_a_doc_number" (label "Numero de Documento"))
  (field ":i9.list_a_expiry" (label "Fecha de Vencimiento"))
  (field ":i9.list_a_issuing_authority" (label "Autoridad Emisora"))
  (field ":i9.list_b_document"
    (label "Titulo del Documento de Lista B (Identidad)")
    (description "ej., Licencia de Conducir, Identificacion Estatal"))
  (field ":i9.list_b_doc_number" (label "Numero de Documento"))
  (field ":i9.list_b_expiry" (label "Fecha de Vencimiento"))
  (field ":i9.list_b_issuing_authority" (label "Autoridad Emisora"))
  (field ":i9.list_c_document"
    (label "Titulo del Documento de Lista C (Empleo)")
    (description "ej., Tarjeta de Seguro Social, Certificado de Nacimiento"))
  (field ":i9.list_c_doc_number" (label "Numero de Documento"))
  (field ":i9.list_c_expiry" (label "Fecha de Vencimiento"))
  (field ":i9.list_c_issuing_authority" (label "Autoridad Emisora"))
  (field ":i9.employee_first_day" (label "Primer Dia de Trabajo del Empleado"))
  (field ":i9.employer_signature"
    (label "Firma del Empleador")
    (description
      "Certifico que he examinado los documentos y parecen ser genuinos"))
  (field ":i9.employer_name"
    (label "Nombre del Empleador o Representante Autorizado"))
  (field ":i9.employer_title" (label "Titulo"))
  (field ":i9.employer_org_name"
    (label "Nombre de la Empresa u Organizacion del Empleador"))
  (field ":i9.employer_org_address"
    (label "Direccion de la Empresa del Empleador")))

(define-document-localized "I-9 Employment Eligibility"
  (locales en es)
  (default-locale en))
```
