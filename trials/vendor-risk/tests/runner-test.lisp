; Runner companion to policy-test.lisp; historical suite is preserved.
(import "../../../preludes/modules/test.lisp" [test is=])
(import "../../../preludes/modules/kernel.lisp" [not])
(import "../src/policy.lisp" [Role Vendor Review Exception activation-blockers
                               can-activate? can-sign-contract? exception-valid?
                               security-review-complete?])
(define today 1000)
(: soc2-review Review)
(define soc2-review {:completed-on 900 :questionnaire-complete true :soc2-type2-issued-on (Some 800) :exception None})
(: ciso-ex Exception)
(define ciso-ex {:approved-by :ciso :reason "SOC 2 audit in progress" :approved-on 950})
(: base Vendor)
(define base {:name "Acme Analytics" :touches-customer-data true
              :processes-customer-personal-data false :dpa-on-file false
              :review (Some soc2-review)})
(: v (-> Bool Bool Bool (Option Review) Vendor))
(define v [touches personal dpa review]
  {:name "Synthetic Vendor" :touches-customer-data touches
   :processes-customer-personal-data personal :dpa-on-file dpa :review review})
(: r (-> Int Bool (Option Int) (Option Exception) Review))
(define r [completed q soc2 ex]
  {:completed-on completed :questionnaire-complete q :soc2-type2-issued-on soc2 :exception ex})
(: ex (-> Role String Int Exception))
(define ex [who why on] {:approved-by who :reason why :approved-on on})

(test "complete review with current SOC 2 activates"
  (is= (can-activate? base today) true))

(test "no review on file blocks"
  (is= (activation-blockers (v true false false None) today) ["no security review on file"]))

(test "questionnaire incomplete blocks"
  (is= (activation-blockers (v true false false (Some (r 900 false (Some 800) None))) today) ["security questionnaire incomplete"]))

(test "neither SOC 2 nor exception blocks"
  (is= (activation-blockers (v true false false (Some (r 900 true None None))) today) ["no current SOC 2 Type II report and no valid CISO exception"]))

(test "CISO exception substitutes for SOC 2"
  (is= (can-activate? (v true false false (Some (r 900 true None (Some ciso-ex)))) today) true))

(test "contract signature uses the same gate"
  (is= (can-sign-contract? (v true false false None) today) false))

(test "vendor not touching customer data needs no review"
  (is= (activation-blockers (v false false false None) today) []))

(test "review on day 364 still current"
  (is= (can-activate? (v true false false (Some (r 636 true (Some 900) None))) today) true))

(test "review exactly 365 days old is expired"
  (is= (activation-blockers (v true false false (Some (r 635 true (Some 900) None))) today) ["security review expired or not yet valid"]))

(test "SOC 2 report older than 12 months is not current"
  (is= (security-review-complete? (v true false false (Some (r 900 true (Some 600) None))) today) false))

(test "future-dated review is not valid"
  (is= (security-review-complete? (v true false false (Some (r 1001 true (Some 900) None))) today) false))

(test "high-risk vendor without DPA blocks"
  (is= (activation-blockers (v true true false (Some soc2-review)) today) ["high-risk vendor has no data processing agreement"]))

(test "high-risk vendor with DPA activates"
  (is= (can-activate? (v true true true (Some soc2-review)) today) true))

(test "personal-data processing implies review even if flag says no customer data"
  (is= (activation-blockers (v false true true None) today) ["no security review on file"]))

(test "all blockers reported together"
  (is= (activation-blockers (v true true false (Some (r 100 false None None))) today) ["security review expired or not yet valid" "security questionnaire incomplete"
        "no current SOC 2 Type II report and no valid CISO exception"
        "high-risk vendor has no data processing agreement"]))

(test "exception from non-CISO is invalid"
  (is= (exception-valid? (ex :security-analyst "ok" 950) today) false))

(test "exception without reason is invalid"
  (is= (exception-valid? (ex :ciso "" 950) today) false))

(test "exception with a blank reason is invalid"
  (is= (exception-valid? (ex :ciso "  " 950) today) false))

(test "exception at day 181 valid"
  (is= (exception-valid? (ex :ciso "audit" 819) today) true))

(test "exception at day 182 expired"
  (is= (exception-valid? (ex :ciso "audit" 818) today) false))

(test "expired exception no longer substitutes for SOC 2"
  (is= (can-activate? (v true false false (Some (r 900 true None (Some (ex :ciso "audit" 700))))) today) false))
