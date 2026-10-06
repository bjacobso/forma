;; Mailer.send is used but only Users.find is declared as a requirement.
(service Users
  (: find (-> String (Effect String [] []))))

(service Mailer
  (: send (-> String String (Effect Unit [] []))))

(: welcome (-> String (Effect Unit [] [Users.find])))
(define welcome [id]
  (do! [email (Users.find id)]
    (Mailer.send email "Welcome!")))
