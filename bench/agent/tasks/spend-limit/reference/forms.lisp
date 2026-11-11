(export spend SpendIR)
(type SpendIR {:kind "Spend" :name Symbol :amount Int})
(form (spend name amount)
 :types {:name (Declares SpendDecl) :amount Int}
 :ir SpendIR
 :check (fn [h] (if (> (get h :amount) 100)
   [{:severity :error :code "spend/over-limit" :message "Spend must not exceed 100." :slot :amount}] []))
 {:kind "Spend" :name name :amount amount})
