;; Effect bodies with several forms: earlier forms run in order for their
;; effects, and the last form is the result.
(type Order {:id String :status String})
(service Orders
  (: find (-> String (Effect Order [] [])))
  (: save (-> Order (Effect Unit [] []))))
(service Audit (: record (-> String (Effect Unit [] []))))
(: ship (-> String (Effect Order [] [Orders Audit.record])))
(define
  ship
  [id]
  (do!
    [order (Orders.find id) :let [shipped (assoc order :status "shipped")]]
    (Audit.record (str "ship " id))
    (Orders.save shipped)
    shipped))
(: cancel (-> Order (Effect Order [] [Orders.save Audit.record])))
(define
  cancel
  [order]
  (let
    [cancelled (assoc order :status "cancelled")]
    (Orders.save cancelled)
    (Audit.record (str "cancel " (get order :id)))
    cancelled))
(: touch (-> Order (Effect Unit [] [Orders.save Audit.record])))
(define touch [order] (do (Audit.record "touch") (Orders.save order) nil))
