;; Mirrors conformance/operational-effects/program.lisp, the fixture both engines share.
(define-error ConsoleUnavailable
  (:fields (field message String)))

(define-service Console
  (:methods
    (print [message String]
      (Effect Unit [ConsoleUnavailable] []))))

(: always-fail (-> String (Effect Unit [ConsoleUnavailable] [])))
(define-operation always-fail [message]
  (fail (ConsoleUnavailable {:message message})))

(: recover (-> String (Effect Unit [] [])))
(define-operation recover [message]
  (catch
    (always-fail message)
    (ConsoleUnavailable error)
    (succeed nil)))

(: log (-> String (Effect Unit [ConsoleUnavailable] [Console.print])))
(define-operation log [message]
  (do! [_ (Console.print message)]
    (succeed nil)))
