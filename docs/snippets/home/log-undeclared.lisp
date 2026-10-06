(error ConsoleUnavailable {:message String})

(service Console
  (: print (-> String (Effect Unit [ConsoleUnavailable] []))))

(: log (-> String (Effect Unit [ConsoleUnavailable] [])))
(define log [message]
  (do! [_ (Console.print message)]
    (succeed nil)))
