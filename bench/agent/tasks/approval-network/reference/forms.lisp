(import "./types.lisp" [Role Facts Decision])
(import "./policy.lisp" [decide])
(export approval Status ApprovalIR)
(type Status (Union "draft" "active"))
(type ApprovalIR {:kind "Approval" :name Symbol :status Status :allowed Bool :due Int :reason String})
(type Holes {:amount Int :role Role :approved-on Int :as-of Int :reason String :status Status})
(: decision (-> Holes Decision))
(define decision [h] (decide {:amount h.amount :role h.role :approved-on h.approved-on :as-of h.as-of :reason h.reason}))
(form (approval name {:keys [amount role approved-on as-of reason status]})
 :types {:name (Declares ApprovalDecl) :amount Int :role Role :approved-on Int :as-of Int :reason String :status Status}
 :ir ApprovalIR
 :check (fn [h] (let [d (decision h)]
  (if (= (get h :status) "active")
   (if d.allowed [] [{:severity :error :code "approval/blocked" :slot :status :message (str "Approval blocked: " d.reason)}]) [])))
 (let [d (decide {:amount amount :role role :approved-on approved-on :as-of as-of :reason reason})]
  {:kind "Approval" :name name :status status :allowed d.allowed :due d.due :reason d.reason}))
