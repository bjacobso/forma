(import "./policy.lisp" [Category ApprovalRole])
(export expense ExpenseIR)
(type ExpenseIR
  {:kind "Expense" :name Symbol :employee String :amount Int :category Category :date Int
   :vendor (Option String) :asset-tag (Option String) :manager (Option String) :finance (Option String)})
(form (expense name {:keys [employee amount category date vendor asset-tag manager finance]})
  "Declare an expense; manager and finance identify people who approved it."
  :types {:name (Declares ExpenseDecl) :employee String :amount (Int :min 0)
          :category Category :date Int :vendor (Option String) :asset-tag (Option String)
          :manager (Option String) :finance (Option String)}
  :ir ExpenseIR
  :check (fn [holes]
    (concat
      (if (= (get holes :category) "software")
        (if (= (get holes :vendor) nil)
          [{:severity :error :code "expense/vendor-required" :message "Software needs a vendor." :slot :category}]
          (if (= (trim (get holes :vendor)) "")
            [{:severity :error :code "expense/vendor-required" :message "Vendor must be nonblank." :slot :vendor}] [])) [])
      (concat
        (if (= (get holes :category) "equipment")
          (if (= (get holes :asset-tag) nil)
            [{:severity :error :code "expense/asset-required" :message "Equipment needs an asset tag." :slot :category}]
            (if (= (trim (get holes :asset-tag)) "")
              [{:severity :error :code "expense/asset-required" :message "Asset tag must be nonblank." :slot :asset-tag}] [])) [])
        (concat
          (if (= (get holes :employee) (get holes :manager))
            [{:severity :error :code "expense/self-approval" :message "Employee cannot approve their own expense." :slot :manager}] [])
          (if (= (get holes :employee) (get holes :finance))
            [{:severity :error :code "expense/self-approval" :message "Employee cannot approve their own expense." :slot :finance}] [])))))
  {:kind "Expense" :name name :employee employee :amount amount :category category :date date
   :vendor vendor :asset-tag asset-tag :manager manager :finance finance})
