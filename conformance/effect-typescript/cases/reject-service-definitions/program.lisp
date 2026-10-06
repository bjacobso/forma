;; Service methods cannot hide requirements, names are unique, and
;; signatures only mention defined errors.
(service Mailer
  (: send (-> String (Effect Unit [Bounced] [Templates.render]))))

(service Templates
  (: render (-> String (Effect String [] []))))

(type Mailer {:host String})

(: notify (-> String (Effect Unit [] [Mailer])))
(define notify [to]
  (Mailer.send to "extra"))
