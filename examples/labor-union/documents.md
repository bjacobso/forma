# Documents

```lisp
(export union-authorization-card)

;; =============================================================================
;; Union Authorization Card
;; =============================================================================

(document union-authorization-card :description "Collect employee acknowledgement, dues authorization, and electronic signature for a covered CBA placement"
 (page employee-authorization :assignee employee :description "Employee Authorization" :completion (completion submit-union-authorization-card :entity Employee)
 (content :unionauth.intro "# Union Authorization Card\n\nReview the covered position, bargaining unit, and authorization language. Confirm your information and sign electronically to complete this required labor-relations task.\n\n---")
 (text :unionauth.employee_name "Employee Name" :required true)
 (text :unionauth.employee_email "Employee Email"  :bind Employee.email)
 (text :unionauth.employee_phone "Employee Phone"  :bind Employee.phone)
 (textarea :unionauth.employee_address "Employee Address" :required true :bind Employee.address)
 (text :unionauth.global_hr_id "Global HR ID"  :bind Employee.global-hr-id)
 (text :unionauth.cba_identifier "CBA Identifier"  :bind Employee.cba-id)
 (content :unionauth.authorization_text "## Authorization\n\nI acknowledge that my position is covered by a collective bargaining agreement. I authorize the employer to process the applicable union authorization and dues deduction according to the active agreement, payroll policy, and any legally required notices.\n\nThis demonstration text is representative and client-neutral; production implementations use the approved language for the applicable CBA and card template version.")
 (checkbox :unionauth.acknowledgement "I have reviewed the CBA authorization information" :required true)
 (checkbox :unionauth.dues_authorization "I authorize applicable union dues deduction for the covered bargaining unit" :required true)
 (checkbox :unionauth.employee_signature "Electronic Signature" :required true :bind Employee.union-card-signed)
 (date :unionauth.signature_date "Signature Date" :required true)))

(document-locale union-authorization-card "en"
 (role employee :label "Employee" :description "The worker completing the union authorization card")
 (section employee-authorization :label "Employee Authorization")
 (field :unionauth.employee_name :label "Employee Name")
 (field :unionauth.employee_email :label "Employee Email")
 (field :unionauth.employee_phone :label "Employee Phone")
 (field :unionauth.employee_address :label "Employee Address")
 (field :unionauth.global_hr_id :label "Global HR ID")
 (field :unionauth.cba_identifier :label "CBA Identifier")
 (field :unionauth.acknowledgement :label "Acknowledgement")
 (field :unionauth.dues_authorization :label "Dues Authorization")
 (field :unionauth.employee_signature :label "Electronic Signature")
 (field :unionauth.signature_date :label "Signature Date"))
```
