;; Layer signatures and provide are checked against what layers really
;; provide and require.
(service Clock
  (: now (Effect Int [] [])))
(service Greeter
  (: greet (-> String (Effect String [] []))))

(layer GreeterLive :provides Greeter
  (define greet [name] (do! [time Clock.now]
        (succeed (str "hello " name " at " time)))))

(: AppLive (Layer [Greeter] [] []))
(layer AppLive GreeterLive)

(: greet-everyone (-> String (Effect String [] [])))
(define greet-everyone [name]
  (provide (Greeter.greet name) GreeterLive))
