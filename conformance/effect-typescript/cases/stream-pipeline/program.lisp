;; Streams: lazy pipelines built from collections and ranges, transformed
;; with pure and effectful steps, and run by collecting, folding, or
;; consuming each element. Stream types carry the errors and requirements
;; of the effects folded into them.

(type Reading {:sensor String
 :celsius Number})

(error SensorOffline {:sensor String})

(service Sensors
  (: read (-> String (Effect Reading [SensorOffline] []))))

(service Sink
  (: write (-> String (Effect Unit [] []))))

(: celsius-values (-> (List Reading) (Stream Number [] [])))
(define celsius-values
   [readings]
    (stream-map (stream-of readings) (fn [reading] (get reading :celsius))))

(: hot-readings (-> (List String) Number (Effect (List Reading) [SensorOffline] [Sensors.read])))
(define hot-readings [sensors threshold]
  (stream-run-collect
    (stream-filter
      (stream-map-effect (stream-of sensors) (fn [sensor] (Sensors.read sensor)) 2)
      (fn [reading] (> (get reading :celsius) threshold)))))

(: sum-of-squares (-> Int (Effect Int [] [])))
(define sum-of-squares [n]
  (stream-run-fold
    (stream-map (stream-range 1 n) (fn [i] (* i i)))
    0
    (fn [total square] (+ total square))))

(: export-first (-> (List String) Int (Effect Unit [SensorOffline] [Sensors Sink])))
(define export-first [sensors limit]
  (stream-run-for-each
    (stream-take (stream-map-effect (stream-of sensors) (fn [sensor] (Sensors.read sensor))) limit)
    (fn [reading] (Sink.write (str (get reading :sensor) "=" (get reading :celsius))))))

(: average (-> (List Reading) (Effect Number [] [])))
(define average [readings]
  (do! [total (stream-run-fold (celsius-values readings) (: 0 Number) (fn [sum value] (+ sum value)))]
    (succeed (if (empty? readings) 0 (/ total (count readings))))))
