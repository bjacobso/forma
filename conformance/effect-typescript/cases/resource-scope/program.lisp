;; Resource safety: connections are acquired with acquire-release and closed
;; in reverse order when their scope ends, whether the work succeeds or
;; fails. A layer holds a connection for its whole lifetime.

(type Connection {:id String})

(type Row {:region String
 :amount Int})

(error QueryFailed {:query String})

(service Pool
  (: open (-> String (Effect Connection [] [])))
  (: close (-> Connection (Effect Unit [] [])))
  (: query (-> Connection String (Effect (List Row) [QueryFailed] []))))

(service Audit
  (: record (-> String (Effect Unit [] []))))

(service ReportStore
  (: save (-> String Int (Effect Unit [QueryFailed] []))))

(: connection (-> String (Effect Connection [] [Pool Scope])))
(define connection [name]
  (acquire-release (Pool.open name)
    (fn [opened] (Pool.close opened))))

(: add-row (-> (Map String Int) Row (Map String Int)))
(define add-row
   [totals row]
    (assoc totals (get row :region)
      (+ (get-or-else (get totals (get row :region)) 0) (get row :amount))))

(: regional-totals (-> String (Effect (Map String Int) [QueryFailed] [Pool Audit])))
(define regional-totals [sql]
  (scoped
    (do! [_ (add-finalizer (Audit.record "report finished"))
          primary (connection "primary")
          replica (connection "replica")
          rows (Pool.query primary sql)
          _ (Audit.record (str "read " (count rows) " rows; replica " (get replica :id) " idle"))]
      (succeed (reduce add-row (: {} (Map String Int)) rows)))))

(: publish (-> String (Effect Int [QueryFailed] [Pool Audit ReportStore])))
(define publish [sql]
  (ensuring
    (do! [totals (regional-totals sql)
          grand (succeed (sum (vals totals)))
          _ (ReportStore.save "grand-total" grand)]
      (succeed grand))
    (Audit.record "publish attempted")))

(layer ReportStoreLive :provides ReportStore
  :setup [store (connection "reports")]
  (define save [name total] (do! [_ (Pool.query store (str "insert " name " " total))]
        (succeed nil))))
