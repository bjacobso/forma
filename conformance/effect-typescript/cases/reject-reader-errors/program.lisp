;; Characters the reader cannot read are reported with a location.
(: greet (-> String String))
(define greet (fn [name] (str "hola " name)))

(: señor String)
(define señor "x")
