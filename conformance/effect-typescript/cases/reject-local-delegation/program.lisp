;; :delegate forwards undefined members to the outer service, which the
;; signature must then declare. Defined members still cannot call their own
;; service.
(error NotFound {:key String})
(service Store
  (: get (-> String (Effect String [NotFound] [])))
  (: set (-> String String (Effect Unit [NotFound] []))))
(: save (-> String (Effect String [NotFound] [Store])))
(define save [name] (do (Store.set "user" name) (Store.get "user")))
(: undeclared-forward (-> String (Effect String [NotFound] [])))
(define
  undeclared-forward
  [name]
  (provide (save name) (implement Store :delegate (define set [key value] (succeed nil)))))
(: forwards-nothing (-> String (Effect String [NotFound] [])))
(define
  forwards-nothing
  [name]
  (provide
    (save name)
    (implement Store :delegate (define get [key] (succeed name)) (define set [key value] (succeed nil)))))
(: delegated-self-call (-> String (Effect String [NotFound] [Store.get])))
(define
  delegated-self-call
  [name]
  (provide (save name) (implement Store :delegate (define set [key value] (do (Store.get key) nil)))))
