;; Synthetic vendor register (brief: vendor risk review). Elaborated with
;; `forma file declarations`. Day numbers are Ints; -1 / "" mean "not on file".
(import "./register-forms.lisp" [vendor])

;; Customer-data vendor, review day 900, SOC 2 issued day 800: may be active on day 1000.
(vendor acme-analytics :status "active" :as-of 1000
        :touches-customer-data true :processes-customer-personal-data false :dpa-on-file false
        :reviewed-on 900 :questionnaire-complete true :soc2-issued-on 800
        :exception-by "" :exception-reason "" :exception-on -1)

;; High-risk vendor with CISO exception instead of SOC 2, and a DPA.
(vendor beacon-mail :status "active" :as-of 1000
        :touches-customer-data true :processes-customer-personal-data true :dpa-on-file true
        :reviewed-on 950 :questionnaire-complete true :soc2-issued-on -1
        :exception-by "ciso" :exception-reason "SOC 2 audit in progress" :exception-on 900)

;; Still under review: proposed is allowed even with blockers.
(vendor cobalt-crm :status "proposed" :as-of 1000
        :touches-customer-data true :processes-customer-personal-data true :dpa-on-file false
        :reviewed-on -1 :questionnaire-complete false :soc2-issued-on -1
        :exception-by "" :exception-reason "" :exception-on -1)

;; No customer data: no review needed.
(vendor delta-catering :status "active" :as-of 1000
        :touches-customer-data false :processes-customer-personal-data false :dpa-on-file false
        :reviewed-on -1 :questionnaire-complete false :soc2-issued-on -1
        :exception-by "" :exception-reason "" :exception-on -1)
