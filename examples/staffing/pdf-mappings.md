# PDF Mappings

```lisp
(export i9-pdf)

(pdf-mapping i9-pdf :display-name "Form I-9 Employment Eligibility Verification" :description "Maps I-9 document instance data to the official USCIS I-9 PDF" :template-blob "sha256-i9-template-placeholder" :template-filename "i-9-blank.pdf"  :document i-9-employment-eligibility
 (direct :i9.last_name "Last Name (Family Name)" :transform uppercase)
 (direct :i9.first_name "First Name (Given Name)" :transform uppercase)
 (direct :i9.middle_initial "Middle Initial")
 (direct :i9.other_last_names "Other Last Names Used")
 (direct :i9.date_of_birth "Date of Birth (mm/dd/yyyy)" :transform date-mm/dd/yyyy)
 (direct :i9.ssn "U.S. Social Security Number" :transform ssn-formatted)
 (direct :i9.email "Employee's E-mail Address")
 (direct :i9.phone "Employee's Telephone Number" :transform phone-formatted)
 (direct :i9.alien_number "Alien Registration Number/USCIS Number")
 (direct :i9.i94_number "Form I-94 Admission Number")
 (direct :i9.foreign_passport_number "Foreign Passport Number")
 (direct :i9.country_of_issuance "Country of Issuance")
 (direct :i9.work_auth_expiry "Expiration Date (if applicable)" :transform date-mm/dd/yyyy)
 (direct :i9.section1_date "Date (mm/dd/yyyy)" :transform date-mm/dd/yyyy)
 (direct :i9.list_a_document "Document Title (List A)")
 (direct :i9.list_a_issuing_authority "Issuing Authority (List A)")
 (direct :i9.list_a_doc_number "Document Number (List A)")
 (direct :i9.list_a_expiry "Expiration Date (List A)" :transform date-mm/dd/yyyy)
 (direct :i9.list_b_document "Document Title (List B)")
 (direct :i9.list_b_issuing_authority "Issuing Authority (List B)")
 (direct :i9.list_b_doc_number "Document Number (List B)")
 (direct :i9.list_b_expiry "Expiration Date (List B)" :transform date-mm/dd/yyyy)
 (direct :i9.list_c_document "Document Title (List C)")
 (direct :i9.list_c_issuing_authority "Issuing Authority (List C)")
 (direct :i9.list_c_doc_number "Document Number (List C)")
 (direct :i9.list_c_expiry "Expiration Date (List C)" :transform date-mm/dd/yyyy)
 (direct :i9.employee_first_day "Employee's First Day of Employment" :transform date-mm/dd/yyyy)
 (direct :i9.employer_name "Last Name, First Name and Title of Employer")
 (direct :i9.employer_org_name "Employer's Business or Organization Name")
 (direct :i9.employer_org_address "Employer's Business or Organization Address")
 (direct :i9.section2_date "Date (mm/dd/yyyy) Section 2" :transform date-mm/dd/yyyy)
 (computed (-> form (get :address_street)) "Address (Street Number and Name)")
 (computed (-> form (get :address_apt)) "Apt. Number")
 (computed (-> form (get :address_city)) "City or Town")
 (computed (-> form (get :address_state)) "State")
 (computed (-> form (get :address_zip)) "ZIP Code")
 (switch :i9.citizenship_status
 (case "citizen"
 (set "1. A citizen of the United States" true))
 (case "noncitizen_national"
 (set "2. A noncitizen national of the United States" true))
 (case "permanent_resident"
 (set "3. A lawful permanent resident" true))
 (case "authorized_alien"
 (set "4. An alien authorized to work" true))))
```
