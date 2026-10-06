;; A dashboard workflow: independent lookups run concurrently, batches are
;; bounded, flaky calls are retried, slow ones are raced or timed out, and
;; background work is forked and joined while a Ref counts progress.

(type Profile {:id String
 :name String})

(type Activity {:id String
 :events Int})

(type Dashboard {:profile Profile
 :activity Activity
 :score Int})

(error Unavailable {:service String})

(service Profiles
  (: fetch (-> String (Effect Profile [Unavailable] [])))
  (: cached (-> String (Effect Profile [Unavailable] []))))

(service Activities
  (: fetch (-> String (Effect Activity [Unavailable] []))))

(service Metrics
  (: track (-> String Int (Effect Unit [] []))))

(: dashboard (-> String (Effect Dashboard [Unavailable] [Profiles.fetch Activities.fetch])))
(define dashboard [id]
  (do! [parts (all {:profile (retry (Profiles.fetch id) :times 2 :schedule (exponential (millis 1)))
                    :activity (Activities.fetch id)}
                   :concurrency :unbounded)]
    (succeed {:profile (get parts :profile)
              :activity (get parts :activity)
              :score (* 10 (get (get parts :activity) :events))})))

(: dashboards (-> (List String) (Effect (List Dashboard) [Unavailable] [Profiles.fetch Activities.fetch])))
(define dashboards [ids]
  (for-each ids (fn [id] (dashboard id)) :concurrency 2))

(: fastest-profile (-> String (Effect Profile [Unavailable] [Profiles])))
(define fastest-profile [id]
  (race (Profiles.fetch id) (Profiles.cached id)))

(: dashboard-within (-> String Int (Effect (Option Dashboard) [Unavailable] [Profiles.fetch Activities.fetch])))
(define dashboard-within [id millis]
  (catch (do! [board (timeout (dashboard id) millis)]
           (succeed (Some board)))
    (TimeoutError _) (succeed None)))

(: compare-activity (-> String String (Effect (Tuple Activity Activity) [Unavailable] [Activities])))
(define compare-activity [left right]
  (all [(Activities.fetch left) (Activities.fetch right)] :concurrency 2))

(: track-all (-> (List String) (Effect Int [] [Metrics])))
(define track-all [names]
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
(define heartbeat [beats]
  (repeat (Metrics.track "heartbeat" 1) :times beats :schedule (spaced 1)))
