(error ConsoleUnavailable {:message String})

(service Console
  (: print (-> String (Effect Unit [ConsoleUnavailable] []))))

(: always-fail (-> String (Effect Unit [ConsoleUnavailable] [])))
(define always-fail [message]
  (fail (ConsoleUnavailable {:message message})))

(: recover (-> String (Effect Unit [] [])))
(define recover [message]
  (catch
    (always-fail message)
    (ConsoleUnavailable error)
    (succeed nil)))

(: log (-> String (Effect Unit [ConsoleUnavailable] [Console.print])))
(define log [message]
  (do! [_ (Console.print message)]
    (succeed nil)))
