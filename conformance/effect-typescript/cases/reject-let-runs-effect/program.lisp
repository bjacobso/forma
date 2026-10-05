;; let binds values; running an effect needs do!.
(define-service Clock
  (:methods
    (now [] (Effect Int [] []))))

(: elapsed (-> Int (Effect Int [] [Clock.now])))
(define-operation elapsed [start]
  (let [now (Clock.now)]
    (succeed (- now start))))
