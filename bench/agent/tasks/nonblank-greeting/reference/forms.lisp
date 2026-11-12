(export greeting GreetingIR)
(type GreetingIR {:kind "Greeting" :name Symbol :message String})
(form (greeting name message)
 :types {:name (Declares GreetingDecl) :message String}
 :ir GreetingIR
 :check (fn [h] (if (= (trim (get h :message)) "")
   [{:severity :error :code "greeting/empty" :message "Message must not be blank." :slot :message}] []))
 {:kind "Greeting" :name name :message message})
