(entity Employee {:name String :active Bool})
(entity Department {:name String})
(relation works-at Employee Department {:since Int})

(: hire (-> String (Action (Id Employee))))
(define hire [name] (create! Employee {:name name :active true}))

(: onboard (-> String (Id Department) (Action (Id Employee))))
(define onboard [name department]
  (do! [employee (hire name)
        :let [since 2026]
        _ (link! works-at employee department {:since since})]
    employee))

(: deactivate (-> (Id Employee) (Action Bool)))
(define deactivate [employee]
  (do! [_ (update! Employee employee {:active false})] true))

(: remove (-> (Id Employee) (Action Unit)))
(define remove [employee] (retract! Employee employee))
