;; Functions and constants have no services in scope; effects that need
;; services are written as operations.
(define-service Sensors
  (:methods
    (read [sensor String] (Effect Int [] []))))

(: readings (-> (Array String) (Stream Int [] [Sensors])))
(define readings
  (fn [sensors] (stream-map-effect (stream-of sensors) (fn [sensor] (Sensors.read sensor)))))

(: doubled (-> Int Int))
(define doubled (fn [n] (succeed (* n 2))))
