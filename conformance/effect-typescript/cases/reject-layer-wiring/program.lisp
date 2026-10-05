;; Layer signatures and provide are checked against what layers really
;; provide and require.
(define-service Clock (:methods (now [] (Effect Int [] []))))
(define-service Greeter (:methods (greet [name String] (Effect String [] []))))

(define-layer GreeterLive
  (:provides Greeter)
  (:methods
    (greet [name]
      (do! [time (Clock.now)]
        (succeed (str "hello " name " at " time))))))

(: AppLive (Layer [Greeter] [] []))
(define-layer AppLive GreeterLive)

(: greet-everyone (-> String (Effect String [] [])))
(define-operation greet-everyone [name]
  (provide (Greeter.greet name) GreeterLive))
