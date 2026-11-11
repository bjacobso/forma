;; Behaviour tests for src/policy.lisp. Each case cites the brief rule it pins.
;; Evaluates to the list of FAILING case names; [] means all pass.
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

(type Case {:name String :ok Bool})
;; One generic helper, instantiated at Bool and at (List String) below.
(: is (-> String a a Case))
(define is [name actual expected] {:name name :ok (= actual expected)})

(define cases
  [;; Rule 1: customer-data vendor needs questionnaire + (SOC2 or exception)
   (is "complete review with current SOC 2 activates" (can-activate? base today) true)
   (is "no review on file blocks" (activation-blockers (v true false false None) today)
       ["no security review on file"])
   (is "questionnaire incomplete blocks"
       (activation-blockers (v true false false (Some (r 900 false (Some 800) None))) today)
       ["security questionnaire incomplete"])
   (is "neither SOC 2 nor exception blocks"
       (activation-blockers (v true false false (Some (r 900 true None None))) today)
       ["no current SOC 2 Type II report and no valid CISO exception"])
   (is "CISO exception substitutes for SOC 2"
       (can-activate? (v true false false (Some (r 900 true None (Some ciso-ex)))) today) true)
   (is "contract signature uses the same gate"
       (can-sign-contract? (v true false false None) today) false)
   (is "vendor not touching customer data needs no review"
       (activation-blockers (v false false false None) today) [])
   ;; Rule 2: reviews expire after 12 months (365 days)
   (is "review on day 364 still current" (can-activate? (v true false false (Some (r 636 true (Some 900) None))) today) true)
   (is "review exactly 365 days old is expired"
       (activation-blockers (v true false false (Some (r 635 true (Some 900) None))) today)
       ["security review expired or not yet valid"])
   (is "SOC 2 report older than 12 months is not current"
       (security-review-complete? (v true false false (Some (r 900 true (Some 600) None))) today) false)
   (is "future-dated review is not valid"
       (security-review-complete? (v true false false (Some (r 1001 true (Some 900) None))) today) false)
   ;; Rule 3: high-risk vendors also need a DPA
   (is "high-risk vendor without DPA blocks"
       (activation-blockers (v true true false (Some soc2-review)) today)
       ["high-risk vendor has no data processing agreement"])
   (is "high-risk vendor with DPA activates" (can-activate? (v true true true (Some soc2-review)) today) true)
   (is "personal-data processing implies review even if flag says no customer data"
       (activation-blockers (v false true true None) today) ["no security review on file"])
   (is "all blockers reported together"
       (activation-blockers (v true true false (Some (r 100 false None None))) today)
       ["security review expired or not yet valid" "security questionnaire incomplete"
        "no current SOC 2 Type II report and no valid CISO exception"
        "high-risk vendor has no data processing agreement"])
   ;; Rule 4: exceptions: CISO only, reason required, 6 months (182 days)
   (is "exception from non-CISO is invalid" (exception-valid? (ex :security-analyst "ok" 950) today) false)
   (is "exception without reason is invalid" (exception-valid? (ex :ciso "" 950) today) false)
   (is "exception with a blank reason is invalid" (exception-valid? (ex :ciso "  " 950) today) false)
   (is "exception at day 181 valid" (exception-valid? (ex :ciso "audit" 819) today) true)
   (is "exception at day 182 expired" (exception-valid? (ex :ciso "audit" 818) today) false)
   (is "expired exception no longer substitutes for SOC 2"
       (can-activate? (v true false false (Some (r 900 true None (Some (ex :ciso "audit" 700))))) today) false)])

(map (fn [c] c.name) (filter (fn [c] (not c.ok)) cases))
