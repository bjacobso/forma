(export greeting GreetingIR)
(type GreetingIR {:kind "Greeting" :name Symbol :message String})
(define decorate [message] (str "Hello, " message))
(form (greeting name message)
  :types {:name (Declares Greeting) :message String}
  :ir GreetingIR
  :check (fn [{:keys [message]}]
    (if (= message "")
      [{:severity :error :code "greeting/empty" :message "Provide a message."}]
      []))
  {:kind "Greeting" :name name :message (decorate message)})
