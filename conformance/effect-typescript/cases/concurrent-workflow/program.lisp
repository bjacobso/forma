;; A dashboard workflow: independent lookups run concurrently, batches are
;; bounded, flaky calls are retried, slow ones are raced or timed out, and
;; background work is forked and joined while a Ref counts progress.

(define-schema Profile
  (Struct
    (field id String)
    (field name String)))

(define-schema Activity
  (Struct
    (field id String)
    (field events Int)))

(define-schema Dashboard
  (Struct
    (field profile Profile)
    (field activity Activity)
    (field score Int)))

(define-error Unavailable (:fields (field service String)))

(define-service Profiles
  (:methods
    (fetch [id String] (Effect Profile [Unavailable] []))
    (cached [id String] (Effect Profile [Unavailable] []))))

(define-service Activities
  (:methods
    (fetch [id String] (Effect Activity [Unavailable] []))))

(define-service Metrics
  (:methods
    (track [name String value Int] (Effect Unit [] []))))

(: dashboard (-> String (Effect Dashboard [Unavailable] [Profiles.fetch Activities.fetch])))
(define-operation dashboard [id]
  (do! [parts (all {:profile (retry (Profiles.fetch id) :times 2 :schedule (exponential (millis 1)))
                    :activity (Activities.fetch id)}
                   :concurrency :unbounded)]
    (succeed {:profile (get parts :profile)
              :activity (get parts :activity)
              :score (* 10 (get (get parts :activity) :events))})))

(: dashboards (-> (Array String) (Effect (Array Dashboard) [Unavailable] [Profiles.fetch Activities.fetch])))
(define-operation dashboards [ids]
  (for-each ids (fn [id] (dashboard id)) :concurrency 2))

(: fastest-profile (-> String (Effect Profile [Unavailable] [Profiles])))
(define-operation fastest-profile [id]
  (race (Profiles.fetch id) (Profiles.cached id)))

(: dashboard-within (-> String Int (Effect (Option Dashboard) [Unavailable] [Profiles.fetch Activities.fetch])))
(define-operation dashboard-within [id millis]
  (catch (do! [board (timeout (dashboard id) millis)]
           (succeed (some board)))
    (TimeoutError _) (succeed none)))

(: compare-activity (-> String String (Effect (Tuple Activity Activity) [Unavailable] [Activities])))
(define-operation compare-activity [left right]
  (all [(Activities.fetch left) (Activities.fetch right)] :concurrency 2))

(: track-all (-> (Array String) (Effect Int [] [Metrics])))
(define-operation track-all [names]
  (do! [counter (ref-make 0)
        worker (fork (for-each names
                       (fn [name]
                         (do! [_ (sleep (millis 1))
                               _ (ref-update counter (fn [n] (+ n 1)))]
                           (Metrics.track name 1)))
                       :concurrency :unbounded))
        _ (join worker)
        total (ref-get counter)]
    (succeed total)))

(: heartbeat (-> Int (Effect Unit [] [Metrics.track])))
(define-operation heartbeat [beats]
  (repeat (Metrics.track "heartbeat" 1) :times beats :schedule (spaced 1)))
