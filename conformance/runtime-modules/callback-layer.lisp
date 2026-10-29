; The standalone Effect target captures dependencies of a deferred callable
; when that callable implements a Service method through a Layer.
(service Store (: get (-> String (Effect Int))))
(service Reader (: read (-> (Effect Int))))

(: load (-> String (Effect Int [] [Store.get])))
(define load [id] (Store.get id))

(: prepare (-> String (-> (Effect Int [] [Store.get]))))
(define prepare [id] (fn [] (load id)))

(: deferred (-> (Effect Int [] [Store.get])))
(define deferred (prepare "layer"))

(layer ReaderLive :provides Reader
  (define read [] (deferred)))
