;; Vendor risk review policy, expressed as pure, typed Forma functions.
;; Source: the trial brief (trials/vendor-risk/REPORT.md, "The brief").
;; Synthetic data only; illustrative, not compliance advice.
;;
;; Forma has no date type (see REPORT.md), so every date is an Int day number
;; (days since an arbitrary epoch). "12 months" = 365 days, "6 months" = 182 days.
;; Kernel `and`/`or`/`not` are macros that file modules import from
;; preludes/kernel.forma.
(import "./preludes/kernel.forma" [and or not])
(export Role Exception Review Vendor
        review-validity-days exception-validity-days
        requires-review? high-risk? review-current? soc2-current? exception-valid?
        security-review-complete? activation-blockers can-activate? can-sign-contract?)

(type Role (Union :ciso :security-analyst :procurement :vendor-manager))

;; Brief: "Exceptions are approved only by the CISO, must give a reason,
;; and expire after 6 months."
(type Exception {:approved-by Role :reason String :approved-on Int})

;; Brief: "a completed security questionnaire and either a current SOC 2 Type II
;; report or an approved exception"; "Reviews expire after 12 months".
(type Review
  {:completed-on Int
   :questionnaire-complete Bool
   :soc2-type2-issued-on (Option Int)
   :exception (Option Exception)})

;; Brief: "Every vendor that touches customer data"; "High-risk vendors (those
;; processing customer personal data) also need a data processing agreement".
(type Vendor
  {:name String
   :touches-customer-data Bool
   :processes-customer-personal-data Bool
   :dpa-on-file Bool
   :review (Option Review)})

(: review-validity-days Int)
(define review-validity-days 365)
(: exception-validity-days Int)
(define exception-validity-days 182)

;; Processing customer personal data is a way of touching customer data.
(: requires-review? (-> Vendor Bool))
(define requires-review? [vendor]
  (or vendor.touches-customer-data vendor.processes-customer-personal-data))

(: high-risk? (-> Vendor Bool))
(define high-risk? [vendor] vendor.processes-customer-personal-data)

;; Valid from the completion day up to, not including, completion + 365.
(: within? (-> Int Int Int Bool))
(define within? [start days today]
  (and (>= today start) (< today (+ start days))))

(: review-current? (-> Review Int Bool))
(define review-current? [review today]
  (within? review.completed-on review-validity-days today))

;; A SOC 2 Type II report counts as current for 12 months after issue.
(: soc2-current? (-> Review Int Bool))
(define soc2-current? [review today]
  (match review.soc2-type2-issued-on
    (Some issued) (within? issued review-validity-days today)
    None false))

(: exception-valid? (-> Exception Int Bool))
(define exception-valid? [ex today]
  (and (= ex.approved-by :ciso)
       (and (not (= (trim ex.reason) ""))
            (within? ex.approved-on exception-validity-days today))))

(: has-valid-exception? (-> Review Int Bool))
(define has-valid-exception? [review today]
  (match review.exception
    (Some ex) (exception-valid? ex today)
    None false))

(type Check {:failed Bool :reason String})

(: review-blockers (-> Review Int (List String)))
(define review-blockers [review today]
  (map (fn [c] c.reason)
       (filter (fn [c] c.failed)
               [{:failed (not (review-current? review today))
                 :reason "security review expired or not yet valid"}
                {:failed (not review.questionnaire-complete)
                 :reason "security questionnaire incomplete"}
                {:failed (not (or (soc2-current? review today)
                                  (has-valid-exception? review today)))
                 :reason "no current SOC 2 Type II report and no valid CISO exception"}])))

(: security-review-complete? (-> Vendor Int Bool))
(define security-review-complete? [vendor today]
  (match vendor.review
    (Some review) (empty? (review-blockers review today))
    None false))

;; Brief: "Procurement must not mark a vendor active while its review is
;; incomplete or expired." Returns every reason activation is blocked.
;; Each rule is represented by one Check, preserving blocker order.
(: activation-blockers (-> Vendor Int (List String)))
(define activation-blockers [vendor today]
  (if (requires-review? vendor)
      (map (fn [c] c.reason)
           (filter (fn [c] c.failed)
                   [{:failed (match vendor.review (Some _) false None true)
                     :reason "no security review on file"}
                    {:failed (match vendor.review
                               (Some review) (not (review-current? review today))
                               None false)
                     :reason "security review expired or not yet valid"}
                    {:failed (match vendor.review
                               (Some review) (not review.questionnaire-complete)
                               None false)
                     :reason "security questionnaire incomplete"}
                    {:failed (match vendor.review
                               (Some review) (not (or (soc2-current? review today)
                                                      (has-valid-exception? review today)))
                               None false)
                     :reason "no current SOC 2 Type II report and no valid CISO exception"}
                    {:failed (and (high-risk? vendor) (not vendor.dpa-on-file))
                     :reason "high-risk vendor has no data processing agreement"}]))
      []))

(: can-activate? (-> Vendor Int Bool))
(define can-activate? [vendor today] (empty? (activation-blockers vendor today)))

;; Brief: "needs a security review before contract signature". Same gate.
(: can-sign-contract? (-> Vendor Int Bool))
(define can-sign-contract? [vendor today] (can-activate? vendor today))

