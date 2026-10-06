;; Catching an error the effect cannot raise is a mistake Forma reports.
(error Timeout {:after Int})
(error NotFound {:id String})

(service Store
  (: get (-> String (Effect String [NotFound] []))))

(: fetch (-> String (Effect String [NotFound] [Store.get])))
(define fetch [id]
  (catch (Store.get id)
    (Timeout error) (succeed "slow")))
