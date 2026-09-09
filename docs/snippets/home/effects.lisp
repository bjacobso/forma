(define-error ConsoleUnavailable
  (:fields (field message String)))

(define-service Console
  (:methods
    (print [message String]
      (Effect Unit [ConsoleUnavailable] []))))

(: log
  (-> String
      (Effect Unit
        [ConsoleUnavailable]
        [Console.print])))
(define-operation log [message]
  (do! [_ (Console.print message)]
    (succeed nil)))
