(export batch BatchIR)
(type BatchIR {:kind "Batch" :name Symbol :size Int})
(form (batch name size)
 :types {:name (Declares BatchDecl) :size Int}
 :ir BatchIR
 :check (fn [h] (if (if (< (get h :size) 1) true (> (get h :size) 50))
   [{:severity :error :code "batch/size" :message "Size must be between 1 and 50." :slot :size}] []))
 {:kind "Batch" :name name :size size})
