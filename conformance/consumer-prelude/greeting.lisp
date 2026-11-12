(type Greeting {:kind "Greeting" :name Symbol})
(form (greet name) "Declare a greeting."
  :types {:name (Declares Greeting)}
  :check (fn [holes] [{:code "greeting/notice" :severity :warning :message "A greeting"}])
  :examples ["(greet world)"]
  :ir Greeting {:kind "Greeting" :name name})
