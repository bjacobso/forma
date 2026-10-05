;; Streams: lazy pipelines built from collections and ranges, transformed
;; with pure and effectful steps, and run by collecting, folding, or
;; consuming each element. Stream types carry the errors and requirements
;; of the effects folded into them.

(define-schema Reading
  (Struct
    (field sensor String)
    (field celsius Number)))

(define-error SensorOffline (:fields (field sensor String)))

(define-service Sensors
  (:methods
    (read [sensor String] (Effect Reading [SensorOffline] []))))

(define-service Sink
  (:methods
    (write [line String] (Effect Unit [] []))))

(: celsius-values (-> (Array Reading) (Stream Number [] [])))
(define celsius-values
  (fn [readings]
    (stream-map (stream-of readings) (fn [reading] (get reading :celsius)))))

(: hot-readings (-> (Array String) Number (Effect (Array Reading) [SensorOffline] [Sensors.read])))
(define-operation hot-readings [sensors threshold]
  (stream-run-collect
    (stream-filter
      (stream-map-effect (stream-of sensors) (fn [sensor] (Sensors.read sensor)) 2)
      (fn [reading] (> (get reading :celsius) threshold)))))

(: sum-of-squares (-> Int (Effect Int [] [])))
(define-operation sum-of-squares [n]
  (stream-run-fold
    (stream-map (stream-range 1 n) (fn [i] (* i i)))
    0
    (fn [total square] (+ total square))))

(: export-first (-> (Array String) Int (Effect Unit [SensorOffline] [Sensors Sink])))
(define-operation export-first [sensors limit]
  (stream-run-for-each
    (stream-take (stream-map-effect (stream-of sensors) (fn [sensor] (Sensors.read sensor))) limit)
    (fn [reading] (Sink.write (str (get reading :sensor) "=" (get reading :celsius))))))

(: average (-> (Array Reading) (Effect Number [] [])))
(define-operation average [readings]
  (do! [total (stream-run-fold (celsius-values readings) (: 0 Number) (fn [sum value] (+ sum value)))]
    (succeed (if (empty? readings) 0 (/ total (count readings))))))
