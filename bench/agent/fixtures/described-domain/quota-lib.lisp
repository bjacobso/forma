(export Plan Region QuotaTierIR plan-ceiling valid-region? effective-burst quota-tier)

(type Plan (Union "free" "pro" "enterprise"))
(type Region (Union "us" "eu" "ap"))
(type QuotaTierIR {:kind "QuotaTier" :name Symbol :plan Plan :max-rpm Int :ceiling Int})

(: plan-ceiling (-> Plan Int))
(define plan-ceiling [plan]
  (match plan
    "free" 60
    "pro" 600
    "enterprise" 6000))

(: valid-region? (-> Plan Region Bool))
(define valid-region? [plan region]
  (match plan
    "free" (= region "us")
    "pro" (if (= region "us") true (= region "eu"))
    "enterprise" true))

(: effective-burst (-> Int Int Int))
(define effective-burst [rpm burst]
  (let [capped (if (> burst rpm) rpm burst)]
    (+ rpm (if (< capped 0) 0 capped))))

(form (quota-tier name {:keys [plan max-rpm]})
  :types {:name (Declares QuotaTierDecl) :plan Plan :max-rpm Int}
  :ir QuotaTierIR
  :check (fn [h]
    (let [ceiling (plan-ceiling (get h :plan))
          rpm (get h :max-rpm)]
      (if (if (<= rpm 0) true (> rpm ceiling))
        [{:severity :error :code "quota/tier-ceiling" :slot :max-rpm :message (str "max-rpm must be between 1 and " ceiling)}]
        [])))
  {:kind "QuotaTier" :name name :plan plan :max-rpm max-rpm :ceiling (plan-ceiling plan)})
