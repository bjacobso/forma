(import "./bench/agent/fixtures/described-domain/quota-lib.lisp" [Plan Region plan-ceiling valid-region? effective-burst])
(export Status ServicePolicyIR service-policy)

(type Status (Union "draft" "active"))
(type ServicePolicyIR {:kind "ServicePolicy" :name Symbol :plan Plan :region Region :rpm Int :burst Int :effective-burst Int :status Status})

(form (service-policy name {:keys [plan region rpm burst status]})
  :types {:name (Declares ServicePolicyDecl) :plan Plan :region Region :rpm Int :burst Int :status Status}
  :ir ServicePolicyIR
  :check (fn [h]
    (let [p (get h :plan)
          r (get h :region)
          rpm (get h :rpm)
          burst (get h :burst)
          st (get h :status)
          ceiling (plan-ceiling p)
          e1 (if (if (<= rpm 0) true (> rpm ceiling))
               [{:severity :error :code "quota/rpm-out-of-range" :slot :rpm :message (str "rpm must be between 1 and " ceiling)}]
               [])
          e2 (if (< burst 0)
               [{:severity :error :code "quota/negative-burst" :slot :burst :message "burst must be non-negative"}]
               [])
          e3 (if (= st "active")
               (if (valid-region? p r)
                 []
                 [{:severity :error :code "quota/region-not-allowed" :slot :region :message (str "region " r " is not allowed for plan " p)}])
               [])]
      (concat (concat e1 e2) e3)))
  {:kind "ServicePolicy"
   :name name
   :plan plan
   :region region
   :rpm rpm
   :burst burst
   :effective-burst (effective-burst rpm burst)
   :status status})
