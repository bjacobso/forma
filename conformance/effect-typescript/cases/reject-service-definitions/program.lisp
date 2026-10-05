;; Service methods cannot hide requirements, names are unique, and
;; signatures only mention defined errors.
(define-service Mailer
  (:methods
    (send [to String] (Effect Unit [Bounced] [Templates.render]))))

(define-service Templates
  (:methods
    (render [name String] (Effect String [] []))))

(define-schema Mailer (Struct (field host String)))

(: notify (-> String (Effect Unit [] [Mailer])))
(define-operation notify [to]
  (Mailer.send to "extra"))
