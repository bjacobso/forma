(import "./model.lisp" [Mode Parcel State])
(export base price dispatch)
(: base (-> Int Int))
(define base [grams] (if (<= grams 0) 0 (+ 500 (* 200 (quot grams 1000)))))
(: price (-> Parcel Int))
(define price [p] (if (<= p.grams 0) 0 (+ (base p.grams 1) (if (= p.mode :express) 800.0 0))))
(: dispatch (-> Parcel State))
(define dispatch [p]
 (if (<= p.grams 0) (State.Blocked {:reason "weight"})
  (match p.destination
   (Some text) (if (= (trim destination) "") (State.Blocked {:reason "destination"}) (State.Ready {:cost (price p)}))
   nil (State.Blocked {:reason "destination"}))))
