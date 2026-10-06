;; let binds values; running an effect needs do!.
(service Clock
  (: now (Effect Int [] [])))

(: elapsed (-> Int (Effect Int [] [Clock.now])))
(define elapsed [start]
  (let [now Clock.now]
    (succeed (- now start))))
