;; Mailer.send is used but only Users.find is declared as a requirement.
(define-service Users
  (:methods
    (find [id String] (Effect String [] []))))

(define-service Mailer
  (:methods
    (send [to String body String] (Effect Unit [] []))))

(: welcome (-> String (Effect Unit [] [Users.find])))
(define-operation welcome [id]
  (do! [email (Users.find id)]
    (Mailer.send email "Welcome!")))
