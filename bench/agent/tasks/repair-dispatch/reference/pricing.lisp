(import "./model.lisp" [Mode Parcel State])
(export base price dispatch)
(: base (-> Int Int))
(define base [grams] (if (<= grams 0) 0 (+ 500 (* 200 (quot (- grams 1) 1000)))))
(: price (-> Parcel Int))
(define price [p] (if (<= p.grams 0) 0 (+ (base p.grams) (if (= p.mode :express) 800 0))))
(: dispatch (-> Parcel State))
(define dispatch [p]
 (if (<= p.grams 0) (State.Blocked {:reason "weight"})
  (match p.destination
   (Some text) (if (= (trim text) "") (State.Blocked {:reason "destination"}) (State.Ready {:cost (price p)}))
   None (State.Blocked {:reason "destination"}))))
