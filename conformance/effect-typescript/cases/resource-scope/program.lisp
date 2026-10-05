;; Resource safety: connections are acquired with acquire-release and closed
;; in reverse order when their scope ends, whether the work succeeds or
;; fails. A layer holds a connection for its whole lifetime.

(define-schema Connection (Struct (field id String)))

(define-schema Row
  (Struct
    (field region String)
    (field amount Int)))

(define-error QueryFailed (:fields (field query String)))

(define-service Pool
  (:methods
    (open [name String] (Effect Connection [] []))
    (close [connection Connection] (Effect Unit [] []))
    (query [connection Connection sql String] (Effect (Array Row) [QueryFailed] []))))

(define-service Audit
  (:methods
    (record [event String] (Effect Unit [] []))))

(define-service ReportStore
  (:methods
    (save [name String total Int] (Effect Unit [QueryFailed] []))))

(: connection (-> String (Effect Connection [] [Pool Scope])))
(define-operation connection [name]
  (acquire-release (Pool.open name)
    (fn [opened] (Pool.close opened))))

(: add-row (-> (Map Int) Row (Map Int)))
(define add-row
  (fn [totals row]
    (assoc totals (get row :region)
      (+ (get-or-else (get totals (get row :region)) 0) (get row :amount)))))

(: regional-totals (-> String (Effect (Map Int) [QueryFailed] [Pool Audit])))
(define-operation regional-totals [sql]
  (scoped
    (do! [_ (add-finalizer (Audit.record "report finished"))
          primary (connection "primary")
          replica (connection "replica")
          rows (Pool.query primary sql)
          _ (Audit.record (str "read " (count rows) " rows; replica " (get replica :id) " idle"))]
      (succeed (reduce add-row (: {} (Map Int)) rows)))))

(: publish (-> String (Effect Int [QueryFailed] [Pool Audit ReportStore])))
(define-operation publish [sql]
  (ensuring
    (do! [totals (regional-totals sql)
          grand (succeed (sum (vals totals)))
          _ (ReportStore.save "grand-total" grand)]
      (succeed grand))
    (Audit.record "publish attempted")))

(define-layer ReportStoreLive
  (:provides ReportStore)
  (:setup [store (connection "reports")])
  (:methods
    (save [name total]
      (do! [_ (Pool.query store (str "insert " name " " total))]
        (succeed nil)))))
