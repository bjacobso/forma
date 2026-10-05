;; Catching an error the effect cannot raise is a mistake Forma reports.
(define-error Timeout (:fields (field after Int)))
(define-error NotFound (:fields (field id String)))

(define-service Store
  (:methods
    (get [id String] (Effect String [NotFound] []))))

(: fetch (-> String (Effect String [NotFound] [Store.get])))
(define-operation fetch [id]
  (catch (Store.get id)
    (Timeout error) (succeed "slow")))
