(type GreetingIR {:kind "Greeting" :name Symbol :message String})
(form (greeting name message)
  :types {:name (Declares Greeting) :message String}
  :ir GreetingIR
  :check (fn [{:keys [message]}]
    (if (= message "")
      [{:severity :error :code "greeting/empty"
        :message "Provide a greeting message." :slot :message}]
      []))
  {:kind "Greeting" :name name :message message})
