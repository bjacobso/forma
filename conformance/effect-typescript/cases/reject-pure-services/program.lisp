;; Functions and constants have no services in scope; effects that need
;; services are written as operations.
(service Sensors
  (: read (-> String (Effect Int [] []))))

(: readings (-> (List String) (Stream Int [] [Sensors])))
(define readings
   [sensors] (stream-map-effect (stream-of sensors) (fn [sensor] (Sensors.read sensor))))

(: doubled (-> Int Int))
(define doubled  [n] (succeed (* n 2)))
